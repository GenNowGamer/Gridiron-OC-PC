using System.IO.MemoryMappedFiles;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text;

namespace GridironCaptureBridge.Protocol;

internal sealed class SharedFramePublisher : IDisposable
{
    private readonly MemoryMappedFile _controlMap;
    private readonly MemoryMappedFile _frameMap;
    private readonly MemoryMappedViewAccessor _control;
    private readonly MemoryMappedViewAccessor _frames;
    private readonly object _lock = new();
    private ulong _sequence;
    private bool _disposed;

    public SharedFramePublisher()
    {
        _controlMap = MemoryMappedFile.CreateOrOpen(
            CapProtocol.ControlMapName,
            CapProtocol.ControlMapSize,
            MemoryMappedFileAccess.ReadWrite);
        _frameMap = MemoryMappedFile.CreateOrOpen(
            CapProtocol.FrameMapName,
            CapProtocol.FrameMapSize,
            MemoryMappedFileAccess.ReadWrite);
        _control = _controlMap.CreateViewAccessor(0, CapProtocol.ControlMapSize, MemoryMappedFileAccess.ReadWrite);
        _frames = _frameMap.CreateViewAccessor(0, CapProtocol.FrameMapSize, MemoryMappedFileAccess.ReadWrite);
        InitHeaders();
    }

    public ulong Sequence
    {
        get { lock (_lock) return _sequence; }
    }

    private unsafe void InitHeaders()
    {
        byte[] controlZero = new byte[CapProtocol.ControlMapSize];
        _control.WriteArray(0, controlZero, 0, controlZero.Length);
        byte[] frameZero = new byte[Math.Min(CapProtocol.FrameHeaderSize + 64, (int)CapProtocol.FrameMapSize)];
        // Only clear header region quickly; slots start unused.
        _frames.WriteArray(0, new byte[CapProtocol.FrameHeaderSize], 0, CapProtocol.FrameHeaderSize);

        var control = new ControlHeader
        {
            Version = CapProtocol.ProtocolVersion,
            HeaderSize = CapProtocol.ControlHeaderSize,
            SourceGeneration = 0,
            SourceLength = 0,
            SourceCapacity = CapProtocol.SourceCapacity,
        };
        fixed (byte* magic = CapProtocol.ControlMagic)
        {
            Unsafe.CopyBlock(control.Magic, magic, 8);
        }
        WriteStruct(_control, 0, control);

        QueryPerformanceFrequency(out long freq);
        var frame = new FrameHeader
        {
            Version = CapProtocol.ProtocolVersion,
            HeaderSize = CapProtocol.FrameHeaderSize,
            SlotCapacity = CapProtocol.SlotCapacity,
            Sequence = 0,
            ActiveSlot = 0,
            Width = 0,
            Height = 0,
            Stride = 0,
            PixelFormat = CapProtocol.PixelFormatBgra8,
            CapturedQpc = 0,
            QpcFrequency = (ulong)freq,
        };
        fixed (byte* magic = CapProtocol.FrameMagic)
        {
            Unsafe.CopyBlock(frame.Magic, magic, 8);
        }
        WriteStruct(_frames, 0, frame);
    }

    public void PublishBgra(ReadOnlySpan<byte> bgra, int width, int height, int srcStride)
    {
        if (width < 8 || height < 8
            || width > CapProtocol.MaxWidth
            || height > CapProtocol.MaxHeight)
        {
            return;
        }

        int dstStride = width * (int)CapProtocol.BytesPerPixel;
        if (srcStride < dstStride || bgra.Length < srcStride * height)
        {
            return;
        }

        if ((ulong)dstStride * (uint)height > CapProtocol.SlotCapacity)
        {
            return;
        }

        lock (_lock)
        {
            uint slot = (uint)((_sequence + 1) & 1ul);
            long slotOffset = CapProtocol.FrameHeaderSize + (long)slot * (long)CapProtocol.SlotCapacity;

            unsafe
            {
                byte* basePtr = null;
                _frames.SafeMemoryMappedViewHandle.AcquirePointer(ref basePtr);
                try
                {
                    // PointerOffset is required — without it writes can land before the
                    // view and abort the process (0xC0000409 / STATUS_STACK_BUFFER_OVERRUN).
                    byte* viewBase = basePtr + _frames.PointerOffset;
                    byte* slotBase = viewBase + slotOffset;
                    for (int y = 0; y < height; y++)
                    {
                        bgra.Slice(y * srcStride, dstStride).CopyTo(new Span<byte>(slotBase + y * dstStride, dstStride));
                    }

                    QueryPerformanceCounter(out long qpc);
                    var header = ReadStruct<FrameHeader>(_frames, 0);
                    header.Width = (uint)width;
                    header.Height = (uint)height;
                    header.Stride = (uint)dstStride;
                    header.PixelFormat = CapProtocol.PixelFormatBgra8;
                    header.CapturedQpc = (ulong)qpc;
                    header.ActiveSlot = slot;
                    Thread.MemoryBarrier();
                    _sequence += 1;
                    header.Sequence = _sequence;
                    WriteStruct(_frames, 0, header);
                }
                finally
                {
                    _frames.SafeMemoryMappedViewHandle.ReleasePointer();
                }
            }
        }
    }

    public string? ReadSelectedSource(out ulong generation)
    {
        var header = ReadStruct<ControlHeader>(_control, 0);
        generation = header.SourceGeneration;
        uint length = Math.Min(header.SourceLength, CapProtocol.SourceCapacity);
        if (length == 0)
        {
            return null;
        }

        byte[] bytes = new byte[length];
        _control.ReadArray(CapProtocol.ControlHeaderSize, bytes, 0, (int)length);
        return Encoding.UTF8.GetString(bytes);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _control.Dispose();
        _frames.Dispose();
        _controlMap.Dispose();
        _frameMap.Dispose();
    }

    private static void WriteStruct<T>(MemoryMappedViewAccessor accessor, long offset, T value)
        where T : struct
    {
        int size = Marshal.SizeOf<T>();
        IntPtr ptr = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(value, ptr, false);
            byte[] bytes = new byte[size];
            Marshal.Copy(ptr, bytes, 0, size);
            accessor.WriteArray(offset, bytes, 0, size);
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    private static T ReadStruct<T>(MemoryMappedViewAccessor accessor, long offset)
        where T : struct
    {
        int size = Marshal.SizeOf<T>();
        byte[] bytes = new byte[size];
        accessor.ReadArray(offset, bytes, 0, size);
        IntPtr ptr = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.Copy(bytes, 0, ptr, size);
            return Marshal.PtrToStructure<T>(ptr)!;
        }
        finally
        {
            Marshal.FreeHGlobal(ptr);
        }
    }

    [DllImport("kernel32.dll")]
    private static extern bool QueryPerformanceCounter(out long value);

    [DllImport("kernel32.dll")]
    private static extern bool QueryPerformanceFrequency(out long value);
}
