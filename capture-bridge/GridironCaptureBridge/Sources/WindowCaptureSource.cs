using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using WinRT;

namespace GridironCaptureBridge.Sources;

internal static class WindowEnumerator
{
    private const int GwlExStyle = -20;
    private const int WsExToolWindow = 0x00000080;
    private const int WsExAppWindow = 0x00040000;

    public static IReadOnlyList<CaptureSourceInfo> ListWindows()
    {
        var results = new List<CaptureSourceInfo>();
        EnumWindows((hwnd, _) =>
        {
            if (!IsWindowVisible(hwnd)) return true;
            if (GetWindowTextLength(hwnd) == 0) return true;
            int ex = GetWindowLong(hwnd, GwlExStyle);
            if ((ex & WsExToolWindow) != 0 && (ex & WsExAppWindow) == 0) return true;
            GetWindowThreadProcessId(hwnd, out uint pid);
            if (pid == 0) return true;

            var title = GetTitle(hwnd);
            if (string.IsNullOrWhiteSpace(title)) return true;
            if (title is "Program Manager" or "Windows Input Experience") return true;

            results.Add(new CaptureSourceInfo
            {
                Id = $"window:{hwnd.ToInt64()}",
                Kind = "window",
                Label = title,
                Available = true,
                Hint = "Prefer borderless or windowed mode for game capture",
            });
            return true;
        }, IntPtr.Zero);

        return results
            .OrderBy(r => r.Label, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static bool TryParseHwnd(string sourceId, out IntPtr hwnd)
    {
        hwnd = IntPtr.Zero;
        if (!sourceId.StartsWith("window:", StringComparison.Ordinal)) return false;
        if (!long.TryParse(sourceId["window:".Length..], out long value)) return false;
        hwnd = new IntPtr(value);
        return hwnd != IntPtr.Zero && IsWindow(hwnd);
    }

    private static string GetTitle(IntPtr hwnd)
    {
        int len = GetWindowTextLength(hwnd);
        if (len <= 0) return string.Empty;
        var buffer = new char[len + 1];
        _ = GetWindowText(hwnd, buffer, buffer.Length);
        return new string(buffer).TrimEnd('\0');
    }

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, char[] lpString, int nMaxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}

internal sealed class WindowCaptureSource : IFrameSource
{
    private static readonly Guid GraphicsCaptureItemGuid = new("79C3F95B-31F7-4EC2-A464-632EF5D30760");

    private readonly ID3D11Device _device;
    private readonly ID3D11DeviceContext _context;
    private readonly IDirect3DDevice _winrtDevice;
    private readonly GraphicsCaptureItem _item;
    private readonly Direct3D11CaptureFramePool _framePool;
    private readonly GraphicsCaptureSession _session;
    private readonly object _lock = new();
    private ID3D11Texture2D? _staging;
    private int _width;
    private int _height;
    private byte[]? _latest;
    private int _latestStride;
    private string _state = "capturing";
    private string? _statusCode;
    private string? _statusMessage;
    private DateTime _windowStart = DateTime.UtcNow;
    private int _framesInWindow;
    private double _approxFps;
    private bool _disposed;

    public string SourceId { get; }
    public string Kind => "window";

    public WindowCaptureSource(string sourceId)
    {
        SourceId = sourceId;
        if (!WindowEnumerator.TryParseHwnd(sourceId, out IntPtr hwnd))
        {
            throw new BridgeException("window_not_found", $"Window not found: {sourceId}");
        }

        D3D11.D3D11CreateDevice(
            null,
            DriverType.Hardware,
            DeviceCreationFlags.BgraSupport,
            new[] { FeatureLevel.Level_11_0, FeatureLevel.Level_10_0 },
            out _device,
            out _,
            out _context);

        using IDXGIDevice dxgiDevice = _device.QueryInterface<IDXGIDevice>();
        _winrtDevice = CreateDirect3DDevice(dxgiDevice);

        _item = CreateItemForWindow(hwnd);
        _width = Math.Max(8, _item.Size.Width);
        _height = Math.Max(8, _item.Size.Height);
        _framePool = Direct3D11CaptureFramePool.CreateFreeThreaded(
            _winrtDevice,
            DirectXPixelFormat.B8G8R8A8UIntNormalized,
            2,
            _item.Size);
        _framePool.FrameArrived += OnFrameArrived;
        _session = _framePool.CreateCaptureSession(_item);
        _session.IsCursorCaptureEnabled = false;
        _session.StartCapture();
    }

    public bool TryGetFrame(out CapturedBgraFrame frame)
    {
        frame = null!;
        lock (_lock)
        {
            if (_latest is null || _width < 8 || _height < 8)
            {
                _state = "no_signal";
                _statusCode = "capture_black";
                _statusMessage = "No frames yet. If this is a game, use borderless or windowed mode.";
                return false;
            }

            // Cheap black-frame heuristic on a sparse sample.
            if (IsMostlyBlack(_latest, _latestStride, _width, _height))
            {
                _state = "no_signal";
                _statusCode = "capture_black";
                _statusMessage = "Captured frames look black. Prefer borderless/windowed mode (exclusive fullscreen often fails).";
                // Still return the frame so calibration can show it.
            }
            else
            {
                _state = "capturing";
                _statusCode = null;
                _statusMessage = null;
            }

            frame = new CapturedBgraFrame
            {
                Bgra = _latest,
                Width = _width,
                Height = _height,
                Stride = _latestStride,
            };
            return true;
        }
    }

    public SourceRuntimeStatus GetStatus()
    {
        lock (_lock)
        {
            return new SourceRuntimeStatus
            {
                State = _state,
                Width = _width,
                Height = _height,
                ApproximateFps = _approxFps,
                Code = _statusCode,
                Message = _statusMessage,
            };
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _framePool.FrameArrived -= OnFrameArrived;
        _session.Dispose();
        _framePool.Dispose();
        _staging?.Dispose();
        _winrtDevice.Dispose();
        _context.Dispose();
        _device.Dispose();
    }

    private void OnFrameArrived(Direct3D11CaptureFramePool sender, object args)
    {
        using Direct3D11CaptureFrame? frame = sender.TryGetNextFrame();
        if (frame is null) return;

        if (frame.ContentSize.Width != _width || frame.ContentSize.Height != _height)
        {
            _width = Math.Max(8, frame.ContentSize.Width);
            _height = Math.Max(8, frame.ContentSize.Height);
            sender.Recreate(
                _winrtDevice,
                DirectXPixelFormat.B8G8R8A8UIntNormalized,
                2,
                frame.ContentSize);
        }

        var access = frame.Surface.As<IDirect3DDxgiInterfaceAccess>();
        Guid textureIid = new("6f15aaf2-d208-4e89-9ab4-489053b8b4b0"); // ID3D11Texture2D
        IntPtr resourcePtr = access.GetInterface(ref textureIid);
        using var texture = new ID3D11Texture2D(resourcePtr);

        var desc = texture.Description;
        EnsureStaging(desc.Width, desc.Height);
        _context.CopyResource(_staging!, texture);
        var mapped = _context.Map(_staging!, 0, MapMode.Read, Vortice.Direct3D11.MapFlags.None);
        try
        {
            int stride = (int)mapped.RowPitch;
            int height = (int)desc.Height;
            int width = (int)desc.Width;
            byte[] buffer = new byte[stride * height];
            unsafe
            {
                new ReadOnlySpan<byte>((void*)mapped.DataPointer, stride * height).CopyTo(buffer);
            }

            lock (_lock)
            {
                _latest = buffer;
                _latestStride = stride;
                _width = width;
                _height = height;
                _framesInWindow++;
                var elapsed = (DateTime.UtcNow - _windowStart).TotalSeconds;
                if (elapsed >= 1.0)
                {
                    _approxFps = _framesInWindow / elapsed;
                    _framesInWindow = 0;
                    _windowStart = DateTime.UtcNow;
                }
            }
        }
        finally
        {
            _context.Unmap(_staging!, 0);
        }
    }

    private void EnsureStaging(uint width, uint height)
    {
        if (_staging is not null)
        {
            var d = _staging.Description;
            if (d.Width == width && d.Height == height) return;
            _staging.Dispose();
            _staging = null;
        }

        _staging = _device.CreateTexture2D(new Texture2DDescription
        {
            Width = width,
            Height = height,
            MipLevels = 1,
            ArraySize = 1,
            Format = Format.B8G8R8A8_UNorm,
            SampleDescription = new SampleDescription(1, 0),
            Usage = ResourceUsage.Staging,
            CPUAccessFlags = CpuAccessFlags.Read,
            BindFlags = BindFlags.None,
        });
    }

    private static bool IsMostlyBlack(byte[] bgra, int stride, int width, int height)
    {
        long lit = 0;
        long samples = 0;
        for (int y = 0; y < height; y += Math.Max(1, height / 32))
        {
            for (int x = 0; x < width; x += Math.Max(1, width / 32))
            {
                int i = y * stride + x * 4;
                if (i + 2 >= bgra.Length) continue;
                samples++;
                if (bgra[i] > 16 || bgra[i + 1] > 16 || bgra[i + 2] > 16) lit++;
            }
        }
        return samples > 0 && lit * 100 < samples * 2;
    }

    private static GraphicsCaptureItem CreateItemForWindow(IntPtr hwnd)
    {
        var factory = ActivationFactory.Get("Windows.Graphics.Capture.GraphicsCaptureItem");
        var interop = (IGraphicsCaptureItemInterop)Marshal.GetObjectForIUnknown(factory.ThisPtr);
        Guid iid = GraphicsCaptureItemGuid;
        IntPtr itemPtr = interop.CreateForWindow(hwnd, ref iid);
        return GraphicsCaptureItem.FromAbi(itemPtr);
    }

    private static IDirect3DDevice CreateDirect3DDevice(IDXGIDevice dxgiDevice)
    {
        ResultFromDxgi(CreateDirect3D11DeviceFromDXGIDevice(dxgiDevice.NativePointer, out IntPtr inspectable));
        return MarshalInterface<IDirect3DDevice>.FromAbi(inspectable);
    }

    private static void ResultFromDxgi(int hr)
    {
        if (hr < 0) Marshal.ThrowExceptionForHR(hr);
    }

    [ComImport]
    [Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IGraphicsCaptureItemInterop
    {
        IntPtr CreateForWindow([In] IntPtr window, [In] ref Guid iid);
        IntPtr CreateForMonitor([In] IntPtr monitor, [In] ref Guid iid);
    }

    [ComImport]
    [Guid("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDirect3DDxgiInterfaceAccess
    {
        IntPtr GetInterface([In] ref Guid iid);
    }

    [DllImport(
        "d3d11.dll",
        EntryPoint = "CreateDirect3D11DeviceFromDXGIDevice",
        SetLastError = true,
        CharSet = CharSet.Unicode,
        ExactSpelling = true,
        CallingConvention = CallingConvention.StdCall)]
    private static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice, out IntPtr graphicsDevice);
}
