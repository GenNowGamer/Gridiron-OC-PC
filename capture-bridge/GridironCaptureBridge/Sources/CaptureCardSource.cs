using System.Runtime.InteropServices;
using SharpGen.Runtime;
using Vortice;
using Vortice.MediaFoundation;

namespace GridironCaptureBridge.Sources;

internal static class MfFormats
{
    public static readonly Guid Nv12 = VideoFormatGuids.FromFourCC(new FourCC('N', 'V', '1', '2'));
    public static readonly Guid Yuy2 = VideoFormatGuids.FromFourCC(new FourCC('Y', 'U', 'Y', '2'));
}

internal static class CaptureCardEnumerator
{
    private static int _mfStarted;

    public static void EnsureMf()
    {
        if (Interlocked.CompareExchange(ref _mfStarted, 1, 0) == 0)
        {
            MediaFactory.MFStartup(true);
        }
    }

    public static IReadOnlyList<CaptureSourceInfo> ListDevices()
    {
        EnsureMf();
        var results = new List<CaptureSourceInfo>();
        using var attrs = MediaFactory.MFCreateAttributes(1);
        attrs.Set(CaptureDeviceAttributeKeys.SourceType, CaptureDeviceAttributeKeys.SourceTypeVidcap);

        using IMFActivateCollection devices = MediaFactory.MFEnumDeviceSources(attrs);
        int index = 0;
        foreach (IMFActivate activate in devices)
        {
            string friendly = ReadString(activate, CaptureDeviceAttributeKeys.FriendlyName)
                ?? $"Capture device {index}";
            string? symlink = ReadString(activate, CaptureDeviceAttributeKeys.SourceTypeVidcapSymbolicLink);
            string idSuffix = !string.IsNullOrWhiteSpace(symlink)
                ? SanitizeId(symlink)
                : $"index:{index}";
            results.Add(new CaptureSourceInfo
            {
                Id = $"card:{idSuffix}",
                Kind = "capture-card",
                Label = friendly,
                Available = true,
                Hint = "Connect Xbox HDMI (or other game feed) to this capture device. Close OBS if the device is busy.",
            });
            index++;
        }

        return results;
    }

    public static string? ResolveSymbolicLink(string sourceId)
    {
        if (!sourceId.StartsWith("card:", StringComparison.Ordinal))
        {
            return null;
        }

        string want = sourceId["card:".Length..];
        if (want.StartsWith("index:", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        // Reverse SanitizeId is lossy; re-enumerate and match sanitized form.
        using var attrs = MediaFactory.MFCreateAttributes(1);
        attrs.Set(CaptureDeviceAttributeKeys.SourceType, CaptureDeviceAttributeKeys.SourceTypeVidcap);
        using IMFActivateCollection devices = MediaFactory.MFEnumDeviceSources(attrs);
        int index = 0;
        foreach (IMFActivate activate in devices)
        {
            string? symlink = ReadString(activate, CaptureDeviceAttributeKeys.SourceTypeVidcapSymbolicLink);
            string idSuffix = !string.IsNullOrWhiteSpace(symlink)
                ? SanitizeId(symlink)
                : $"index:{index}";
            if (string.Equals(idSuffix, want, StringComparison.OrdinalIgnoreCase)
                || string.Equals($"index:{index}", want, StringComparison.OrdinalIgnoreCase))
            {
                return symlink;
            }
            index++;
        }

        return null;
    }

    public static int ResolveIndex(string sourceId)
    {
        if (!sourceId.StartsWith("card:", StringComparison.Ordinal))
        {
            return -1;
        }

        string want = sourceId["card:".Length..];
        if (want.StartsWith("index:", StringComparison.OrdinalIgnoreCase)
            && int.TryParse(want["index:".Length..], out int index))
        {
            return index;
        }

        using var attrs = MediaFactory.MFCreateAttributes(1);
        attrs.Set(CaptureDeviceAttributeKeys.SourceType, CaptureDeviceAttributeKeys.SourceTypeVidcap);
        using IMFActivateCollection devices = MediaFactory.MFEnumDeviceSources(attrs);
        int i = 0;
        foreach (IMFActivate activate in devices)
        {
            string? symlink = ReadString(activate, CaptureDeviceAttributeKeys.SourceTypeVidcapSymbolicLink);
            string idSuffix = !string.IsNullOrWhiteSpace(symlink)
                ? SanitizeId(symlink)
                : $"index:{i}";
            if (string.Equals(idSuffix, want, StringComparison.OrdinalIgnoreCase))
            {
                return i;
            }
            i++;
        }

        return -1;
    }

    private static string? ReadString(IMFAttributes attrs, Guid key)
    {
        try
        {
            return attrs.GetAllocatedString(key);
        }
        catch
        {
            return null;
        }
    }

    internal static string SanitizeId(string value)
        => value.Replace('\\', '_').Replace('?', '_');
}

/// <summary>
/// Capture-card frame source. All Media Foundation calls run on a dedicated
/// STA thread — Elgato/MF drivers commonly crash when ReadSample is called from
/// a different thread than the one that created the Source Reader.
/// </summary>
internal sealed class CaptureCardSource : IFrameSource
{
    private readonly Thread _thread;
    private readonly BlockingWorkQueue _queue = new();
    private IMFMediaSource? _mediaSource;
    private IMFSourceReader? _reader;
    private int _width;
    private int _height;
    private int _stride;
    private string? _statusCode;
    private string? _statusMessage;
    private string _state = "starting";
    private int _framesInWindow;
    private DateTime _windowStart = DateTime.UtcNow;
    private double _approxFps;
    private Exception? _startError;
    private readonly ManualResetEventSlim _started = new(false);
    private volatile bool _disposed;

    public string SourceId { get; }
    public string Kind => "capture-card";

    public CaptureCardSource(string sourceId)
    {
        SourceId = sourceId;
        CaptureCardEnumerator.EnsureMf();
        _thread = new Thread(ThreadMain)
        {
            IsBackground = true,
            Name = "GridironCaptureCardMF",
        };
        _thread.SetApartmentState(ApartmentState.STA);
        _thread.Start();
        if (!_started.Wait(15000))
        {
            throw new BridgeException("device_busy", "Timed out opening capture device.");
        }

        if (_startError != null)
        {
            if (_startError is BridgeException bridge)
            {
                throw bridge;
            }

            throw new BridgeException("device_busy", _startError.Message);
        }
    }

    public bool TryGetFrame(out CapturedBgraFrame frame)
    {
        CapturedBgraFrame? result = null;
        Exception? error = null;
        using var done = new ManualResetEventSlim(false);
        _queue.Enqueue(() =>
        {
            try
            {
                result = ReadFrameOnThread();
            }
            catch (Exception ex)
            {
                error = ex;
            }
            finally
            {
                done.Set();
            }
        });

        if (!done.Wait(2000))
        {
            frame = null!;
            _state = "error";
            _statusCode = "no_signal";
            _statusMessage = "Timed out waiting for a capture-card frame.";
            return false;
        }

        if (error != null || result is null)
        {
            frame = null!;
            _state = "no_signal";
            _statusCode = "no_signal";
            _statusMessage = error?.Message ?? "No video signal from capture device.";
            return false;
        }

        frame = result;
        return true;
    }

    public SourceRuntimeStatus GetStatus()
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

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        using var done = new ManualResetEventSlim(false);
        _queue.Enqueue(() =>
        {
            try
            {
                _reader?.Dispose();
                _reader = null;
                try { _mediaSource?.Shutdown(); } catch { /* ignore */ }
                _mediaSource?.Dispose();
                _mediaSource = null;
            }
            finally
            {
                done.Set();
                _queue.Complete();
            }
        });
        done.Wait(3000);
        if (!_thread.Join(3000))
        {
            // Best-effort; process exit will clean up.
        }
        _started.Dispose();
    }

    private void ThreadMain()
    {
        try
        {
            OpenDeviceOnThread();
            _state = "capturing";
            _started.Set();
            _queue.Run();
        }
        catch (Exception ex)
        {
            _startError = ex;
            _state = "error";
            _started.Set();
        }
    }

    private void OpenDeviceOnThread()
    {
        string? symlink = CaptureCardEnumerator.ResolveSymbolicLink(SourceId);
        int index = CaptureCardEnumerator.ResolveIndex(SourceId);

        try
        {
            if (!string.IsNullOrWhiteSpace(symlink))
            {
                using var openAttrs = MediaFactory.MFCreateAttributes(2);
                openAttrs.Set(CaptureDeviceAttributeKeys.SourceType, CaptureDeviceAttributeKeys.SourceTypeVidcap);
                openAttrs.Set(CaptureDeviceAttributeKeys.SourceTypeVidcapSymbolicLink, symlink);
                MediaFactory.MFCreateDeviceSource(openAttrs, out _mediaSource);
            }
            else
            {
                using var attrs = MediaFactory.MFCreateAttributes(1);
                attrs.Set(CaptureDeviceAttributeKeys.SourceType, CaptureDeviceAttributeKeys.SourceTypeVidcap);
                using IMFActivateCollection devices = MediaFactory.MFEnumDeviceSources(attrs);
                IMFActivate? chosen = null;
                int i = 0;
                foreach (IMFActivate activate in devices)
                {
                    if (i == index)
                    {
                        chosen = activate;
                        break;
                    }
                    i++;
                }

                if (chosen is null)
                {
                    throw new BridgeException("window_not_found", $"Capture device not found: {SourceId}");
                }

                _mediaSource = chosen.ActivateObject<IMFMediaSource>();
            }
        }
        catch (BridgeException)
        {
            throw;
        }
        catch (SharpGenException ex) when (
            ex.HResult == unchecked((int)0x800700AA)
            || ex.HResult == unchecked((int)0xC00D3704)
            || ex.HResult == unchecked((int)0xC00D3EA2))
        {
            throw new BridgeException(
                "device_busy",
                "Capture device is busy or unavailable. Close OBS Studio (and any other app using the 4K60 Pro), then try again.");
        }
        catch (Exception ex)
        {
            throw new BridgeException("device_busy", $"Could not open capture device: {ex.Message}");
        }

        // Do NOT set EnableVideoProcessing — it is not realtime-safe and has
        // crashed Elgato drivers when converting 4K YUV → RGB32.
        using var readerAttrs = MediaFactory.MFCreateAttributes(1);
        _reader = MediaFactory.MFCreateSourceReaderFromMediaSource(_mediaSource, readerAttrs);
        _reader.SetStreamSelection(SourceReaderIndex.AllStreams, false);
        _reader.SetStreamSelection(SourceReaderIndex.FirstVideoStream, true);

        PreferReadableMediaType(_reader);
        using var current = _reader.GetCurrentMediaType(SourceReaderIndex.FirstVideoStream);
        UnpackFrameSize(current, out _width, out _height, out _stride);
        if (_width < 8 || _height < 8)
        {
            throw new BridgeException("no_signal", "Capture device opened but returned an invalid frame size (is HDMI signal present?).");
        }
    }

    private CapturedBgraFrame? ReadFrameOnThread()
    {
        if (_reader is null || _disposed)
        {
            return null;
        }

        using IMFSample? sample = _reader.ReadSample(
            SourceReaderIndex.FirstVideoStream,
            SourceReaderControlFlag.None,
            out _,
            out SourceReaderFlag flags,
            out _);

        if (flags.HasFlag(SourceReaderFlag.Error) || sample is null)
        {
            _state = "no_signal";
            _statusCode = "no_signal";
            _statusMessage = "No video signal from capture device. Check Xbox HDMI and that the card input is live.";
            return null;
        }

        if (flags.HasFlag(SourceReaderFlag.CurrentMediaTypeChanged))
        {
            using var current = _reader.GetCurrentMediaType(SourceReaderIndex.FirstVideoStream);
            UnpackFrameSize(current, out _width, out _height, out _stride);
        }

        using IMFMediaBuffer buffer = sample.ConvertToContiguousBuffer();
        buffer.Lock(out IntPtr data, out _, out int currentLength);
        try
        {
            if (_width <= 0 || _height <= 0)
            {
                using var current = _reader.GetCurrentMediaType(SourceReaderIndex.FirstVideoStream);
                UnpackFrameSize(current, out _width, out _height, out _stride);
            }

            Guid subtype;
            using (var current = _reader.GetCurrentMediaType(SourceReaderIndex.FirstVideoStream))
            {
                subtype = current.GetGUID(MediaTypeAttributeKeys.Subtype);
            }

            byte[]? bgra = ConvertToBgra(data, currentLength, _width, _height, _stride, subtype);
            if (bgra is null)
            {
                _state = "error";
                _statusCode = "no_signal";
                _statusMessage = $"Unsupported capture format {subtype}.";
                return null;
            }

            int stride = _width * 4;
            NoteFrame();
            _state = "capturing";
            _statusCode = null;
            _statusMessage = null;
            return new CapturedBgraFrame
            {
                Bgra = bgra,
                Width = _width,
                Height = _height,
                Stride = stride,
            };
        }
        finally
        {
            buffer.Unlock();
        }
    }

    private static void PreferReadableMediaType(IMFSourceReader reader)
    {
        // Prefer ~1080p for OCR latency; fall back through native types.
        var candidates = new List<(int score, int index, IMFMediaType type)>();
        for (int i = 0; ; i++)
        {
            IMFMediaType? native;
            try
            {
                native = reader.GetNativeMediaType(SourceReaderIndex.FirstVideoStream, i);
            }
            catch
            {
                break;
            }

            if (native is null) break;
            try
            {
                Guid subtype = native.GetGUID(MediaTypeAttributeKeys.Subtype);
                UnpackFrameSize(native, out int width, out int height, out _);
                int score = ScoreMediaType(width, height, subtype);
                candidates.Add((score, i, native));
            }
            catch
            {
                native.Dispose();
            }
        }

        candidates.Sort((a, b) => b.score.CompareTo(a.score));
        Exception? last = null;
        foreach (var (_, _, type) in candidates)
        {
            try
            {
                reader.SetCurrentMediaType(SourceReaderIndex.FirstVideoStream, type);
                foreach (var c in candidates) c.type.Dispose();
                return;
            }
            catch (Exception ex)
            {
                last = ex;
            }
        }

        foreach (var c in candidates) c.type.Dispose();

        // Last resort: ask MF for RGB32 without EnableVideoProcessing.
        using var rgbType = MediaFactory.MFCreateMediaType();
        rgbType.Set(MediaTypeAttributeKeys.MajorType, MediaTypeGuids.Video);
        rgbType.Set(MediaTypeAttributeKeys.Subtype, VideoFormatGuids.Rgb32);
        try
        {
            reader.SetCurrentMediaType(SourceReaderIndex.FirstVideoStream, rgbType);
        }
        catch (Exception ex)
        {
            throw new BridgeException(
                "no_signal",
                $"Could not configure a readable format from the capture device: {last?.Message ?? ex.Message}");
        }
    }

    private static int ScoreMediaType(int width, int height, Guid subtype)
    {
        int score = 0;
        // Prefer 1080p-class for OCR; still accept 1440/4K.
        if (width == 1920 && height == 1080) score += 300;
        else if (width == 1280 && height == 720) score += 220;
        else if (width == 2560 && height == 1440) score += 160;
        else if (width == 3840 && height == 2160) score += 80;
        else if (width >= 640 && height >= 360) score += 40;

        if (subtype == VideoFormatGuids.Rgb32 || subtype == VideoFormatGuids.Argb32) score += 50;
        else if (subtype == MfFormats.Nv12) score += 40;
        else if (subtype == MfFormats.Yuy2) score += 30;
        else score += 5;
        return score;
    }

    private static unsafe byte[]? ConvertToBgra(
        IntPtr data,
        int length,
        int width,
        int height,
        int stride,
        Guid subtype)
    {
        if (width < 8 || height < 8) return null;
        int dstStride = width * 4;
        long need = (long)dstStride * height;
        if (need > int.MaxValue) return null;
        byte[] bgra = new byte[need];

        if (subtype == VideoFormatGuids.Rgb32 || subtype == VideoFormatGuids.Argb32)
        {
            int rowBytes = Math.Min(Math.Abs(stride) <= 0 ? dstStride : Math.Abs(stride), dstStride);
            int srcStride = Math.Abs(stride) <= 0 ? dstStride : Math.Abs(stride);
            if (length < srcStride * (height - 1) + rowBytes) return null;
            for (int y = 0; y < height; y++)
            {
                Marshal.Copy(data + y * srcStride, bgra, y * dstStride, rowBytes);
            }

            // RGB32 from MF is typically BGRX; alpha unused — fine for OCR.
            return bgra;
        }

        if (subtype == MfFormats.Nv12)
        {
            // NV12: Y plane height rows, then interleaved UV at height/2.
            int yStride = stride > 0 ? stride : width;
            if (length < yStride * height + yStride * (height / 2)) return null;
            byte* src = (byte*)data;
            for (int y = 0; y < height; y++)
            {
                byte* yRow = src + y * yStride;
                byte* uvRow = src + yStride * height + (y / 2) * yStride;
                int dstRow = y * dstStride;
                for (int x = 0; x < width; x++)
                {
                    int Y = yRow[x];
                    int U = uvRow[(x & ~1)] - 128;
                    int V = uvRow[(x & ~1) + 1] - 128;
                    int C = Y - 16;
                    int r = (298 * C + 409 * V + 128) >> 8;
                    int g = (298 * C - 100 * U - 208 * V + 128) >> 8;
                    int b = (298 * C + 516 * U + 128) >> 8;
                    bgra[dstRow + x * 4] = (byte)Math.Clamp(b, 0, 255);
                    bgra[dstRow + x * 4 + 1] = (byte)Math.Clamp(g, 0, 255);
                    bgra[dstRow + x * 4 + 2] = (byte)Math.Clamp(r, 0, 255);
                    bgra[dstRow + x * 4 + 3] = 255;
                }
            }

            return bgra;
        }

        if (subtype == MfFormats.Yuy2)
        {
            int srcStride = stride > 0 ? stride : width * 2;
            if (length < srcStride * height) return null;
            byte* src = (byte*)data;
            for (int y = 0; y < height; y++)
            {
                byte* row = src + y * srcStride;
                int dstRow = y * dstStride;
                for (int x = 0; x < width; x += 2)
                {
                    int y0 = row[x * 2];
                    int u = row[x * 2 + 1] - 128;
                    int y1 = row[x * 2 + 2];
                    int v = row[x * 2 + 3] - 128;
                    WriteYuvPixel(bgra, dstRow + x * 4, y0, u, v);
                    if (x + 1 < width)
                    {
                        WriteYuvPixel(bgra, dstRow + (x + 1) * 4, y1, u, v);
                    }
                }
            }

            return bgra;
        }

        return null;
    }

    private static void WriteYuvPixel(byte[] bgra, int offset, int y, int u, int v)
    {
        int c = y - 16;
        int r = (298 * c + 409 * v + 128) >> 8;
        int g = (298 * c - 100 * u - 208 * v + 128) >> 8;
        int b = (298 * c + 516 * u + 128) >> 8;
        bgra[offset] = (byte)Math.Clamp(b, 0, 255);
        bgra[offset + 1] = (byte)Math.Clamp(g, 0, 255);
        bgra[offset + 2] = (byte)Math.Clamp(r, 0, 255);
        bgra[offset + 3] = 255;
    }

    private void NoteFrame()
    {
        _framesInWindow++;
        var elapsed = (DateTime.UtcNow - _windowStart).TotalSeconds;
        if (elapsed >= 1.0)
        {
            _approxFps = _framesInWindow / elapsed;
            _framesInWindow = 0;
            _windowStart = DateTime.UtcNow;
        }
    }

    private static void UnpackFrameSize(IMFMediaType type, out int width, out int height, out int stride)
    {
        ulong frameSize = type.GetUInt64(MediaTypeAttributeKeys.FrameSize);
        width = (int)(frameSize >> 32);
        height = (int)(frameSize & 0xffffffff);
        try
        {
            int raw = (int)type.GetUInt32(MediaTypeAttributeKeys.DefaultStride);
            stride = Math.Abs(raw);
        }
        catch
        {
            stride = width * 4;
        }
    }
}

internal sealed class BlockingWorkQueue
{
    private readonly Queue<Action> _items = new();
    private readonly object _lock = new();
    private bool _completed;

    public void Enqueue(Action action)
    {
        lock (_lock)
        {
            if (_completed) return;
            _items.Enqueue(action);
            Monitor.Pulse(_lock);
        }
    }

    public void Complete()
    {
        lock (_lock)
        {
            _completed = true;
            Monitor.PulseAll(_lock);
        }
    }

    public void Run()
    {
        while (true)
        {
            Action? next = null;
            lock (_lock)
            {
                while (_items.Count == 0 && !_completed)
                {
                    Monitor.Wait(_lock);
                }

                if (_items.Count == 0 && _completed)
                {
                    return;
                }

                next = _items.Dequeue();
            }

            next?.Invoke();
        }
    }
}
