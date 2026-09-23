using System.Text.Json;
using GridironCaptureBridge.Protocol;
using GridironCaptureBridge.Sources;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace GridironCaptureBridge;

internal sealed class BridgeService : IDisposable
{
    private readonly SharedFramePublisher _publisher = new();
    private readonly object _gate = new();
    private IFrameSource? _source;
    private CancellationTokenSource? _loopCts;
    private Task? _loopTask;
    private CapturedBgraFrame? _lastFrame;
    private bool _disposed;

    public object Hello()
    {
        return new
        {
            schemaVersion = "1.0",
            name = "gridiron-capture-bridge",
            version = "0.1.0",
            capabilities = new[] { "captureCard", "windowCapture" },
            protocol = new
            {
                controlMap = CapProtocol.ControlMapName,
                frameMap = CapProtocol.FrameMapName,
            },
        };
    }

    public object ListSources()
    {
        var sources = new List<object>();
        foreach (var card in CaptureCardEnumerator.ListDevices())
        {
            sources.Add(new
            {
                id = card.Id,
                kind = card.Kind,
                label = card.Label,
                available = card.Available,
                hint = card.Hint,
            });
        }
        foreach (var window in WindowEnumerator.ListWindows())
        {
            sources.Add(new
            {
                id = window.Id,
                kind = window.Kind,
                label = window.Label,
                available = window.Available,
                hint = window.Hint,
            });
        }
        return new { sources };
    }

    public object SelectSource(string sourceId)
    {
        if (string.IsNullOrWhiteSpace(sourceId))
        {
            throw new BridgeException("invalid_params", "sourceId is required");
        }

        IFrameSource next;
        if (sourceId.StartsWith("card:", StringComparison.Ordinal))
        {
            next = new CaptureCardSource(sourceId);
        }
        else if (sourceId.StartsWith("window:", StringComparison.Ordinal))
        {
            next = new WindowCaptureSource(sourceId);
        }
        else
        {
            throw new BridgeException("invalid_params", "sourceId must start with card: or window:");
        }

        lock (_gate)
        {
            StopLoop_NoLock();
            _source?.Dispose();
            _source = next;
            _lastFrame = null;
            _loopCts = new CancellationTokenSource();
            _loopTask = Task.Run(() => PublishLoop(_loopCts.Token));
        }

        // Give the first frames a moment to arrive (cards can take >100ms).
        for (int i = 0; i < 25; i++)
        {
            lock (_gate)
            {
                if (_lastFrame is not null) break;
            }
            Thread.Sleep(40);
        }
        return Status();
    }

    public object Status()
    {
        lock (_gate)
        {
            if (_source is null)
            {
                return new
                {
                    state = "idle",
                    sourceId = (string?)null,
                    width = 0,
                    height = 0,
                    sequence = _publisher.Sequence,
                };
            }

            var st = _source.GetStatus();
            return new
            {
                state = st.State,
                sourceId = _source.SourceId,
                kind = _source.Kind,
                width = st.Width,
                height = st.Height,
                approximateFps = st.ApproximateFps,
                sequence = _publisher.Sequence,
                code = st.Code,
                message = st.Message,
            };
        }
    }

    public object PreviewFrame(int maxWidth = 960)
    {
        CapturedBgraFrame frame;
        lock (_gate)
        {
            if (_lastFrame is null)
            {
                throw new BridgeException("no_signal", "No frame available yet. Select a source and wait for signal (Xbox on, HDMI live, OBS closed).");
            }
            frame = _lastFrame;
        }

        maxWidth = Math.Clamp(maxWidth <= 0 ? 960 : maxWidth, 160, 1920);
        // Downscale before PNG encode so 4K cards do not explode memory on preview.
        int targetWidth = frame.Width;
        int targetHeight = frame.Height;
        if (targetWidth > maxWidth)
        {
            targetHeight = Math.Max(1, (int)Math.Round(targetHeight * (maxWidth / (double)targetWidth)));
            targetWidth = maxWidth;
        }

        byte[] packed = PackBgra(frame);
        using var image = Image.LoadPixelData<Bgra32>(packed, frame.Width, frame.Height);
        if (image.Width != targetWidth || image.Height != targetHeight)
        {
            image.Mutate(ctx => ctx.Resize(new ResizeOptions
            {
                Size = new Size(targetWidth, targetHeight),
                Mode = ResizeMode.Stretch,
            }));
        }

        using var ms = new MemoryStream();
        image.Save(ms, new PngEncoder { CompressionLevel = PngCompressionLevel.BestSpeed });
        string dataUrl = "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
        return new
        {
            imageData = dataUrl,
            width = image.Width,
            height = image.Height,
            sourceWidth = frame.Width,
            sourceHeight = frame.Height,
        };
    }

    private static byte[] PackBgra(CapturedBgraFrame frame)
    {
        int rowBytes = frame.Width * 4;
        if (frame.Stride == rowBytes) return frame.Bgra;
        byte[] packed = new byte[rowBytes * frame.Height];
        for (int y = 0; y < frame.Height; y++)
        {
            Buffer.BlockCopy(frame.Bgra, y * frame.Stride, packed, y * rowBytes, rowBytes);
        }
        return packed;
    }

    private void PublishLoop(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try
            {
                IFrameSource? source;
                lock (_gate) source = _source;
                if (source is null)
                {
                    break;
                }

                if (source.TryGetFrame(out var frame))
                {
                    try
                    {
                        _publisher.PublishBgra(frame.Bgra, frame.Width, frame.Height, frame.Stride);
                    }
                    catch (Exception ex)
                    {
                        Console.Error.WriteLine($"[bridge] publish failed: {ex.Message}");
                    }

                    lock (_gate) _lastFrame = frame;
                }
                else
                {
                    Thread.Sleep(16);
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[bridge] capture loop error: {ex}");
                Thread.Sleep(50);
            }
        }
    }

    private void StopLoop_NoLock()
    {
        try
        {
            _loopCts?.Cancel();
            _loopTask?.Wait(1000);
        }
        catch
        {
            // ignore
        }
        _loopCts?.Dispose();
        _loopCts = null;
        _loopTask = null;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        lock (_gate)
        {
            StopLoop_NoLock();
            _source?.Dispose();
            _source = null;
        }
        _publisher.Dispose();
    }
}

internal sealed class JsonlServer
{
    private readonly BridgeService _service;
    private readonly TextReader _reader;
    private readonly TextWriter _writer;

    public JsonlServer(BridgeService service, Stream input, Stream output)
    {
        _service = service;
        _reader = new StreamReader(input, new System.Text.UTF8Encoding(false), detectEncodingFromByteOrderMarks: false, bufferSize: 64 * 1024, leaveOpen: true);
        _writer = new StreamWriter(output, new System.Text.UTF8Encoding(false), bufferSize: 64 * 1024, leaveOpen: true)
        {
            AutoFlush = true,
            NewLine = "\n",
        };
    }

    public async Task RunAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            string? line = await _reader.ReadLineAsync(token).ConfigureAwait(false);
            if (line is null) break;
            line = line.Trim();
            if (line.Length == 0) continue;

            JsonDocument doc;
            try
            {
                doc = JsonDocument.Parse(line);
            }
            catch (Exception ex)
            {
                Write(new { id = (string?)null, ok = false, error = new { code = "invalid_json", message = ex.Message } });
                continue;
            }

            using (doc)
            {
                var root = doc.RootElement;
                string? id = root.TryGetProperty("id", out var idEl) ? idEl.ToString() : null;
                string command = root.TryGetProperty("command", out var cmdEl) ? cmdEl.GetString() ?? "" : "";
                JsonElement paramsEl = root.TryGetProperty("params", out var p) ? p : default;

                try
                {
                    object result = Dispatch(command, paramsEl);
                    Write(new { id, ok = true, schemaVersion = "1.0", result });
                    if (command == "shutdown")
                    {
                        break;
                    }
                }
                catch (BridgeException ex)
                {
                    Write(new { id, ok = false, schemaVersion = "1.0", error = new { code = ex.Code, message = ex.Message } });
                }
                catch (Exception ex)
                {
                    Write(new { id, ok = false, schemaVersion = "1.0", error = new { code = "bridge_error", message = ex.Message } });
                }
            }
        }
    }

    private object Dispatch(string command, JsonElement paramsEl)
    {
        return command switch
        {
            "hello" => _service.Hello(),
            "sources.list" => _service.ListSources(),
            "source.select" => _service.SelectSource(GetString(paramsEl, "sourceId") ?? GetString(paramsEl, "source") ?? ""),
            "source.status" => _service.Status(),
            "preview.frame" => _service.PreviewFrame(GetInt(paramsEl, "width", 960)),
            "shutdown" => new { shuttingDown = true },
            _ => throw new BridgeException("unknown_command", $"Unknown command: {command}"),
        };
    }

    private static string? GetString(JsonElement el, string name)
    {
        if (el.ValueKind != JsonValueKind.Object) return null;
        if (!el.TryGetProperty(name, out var prop)) return null;
        return prop.GetString();
    }

    private static int GetInt(JsonElement el, string name, int fallback)
    {
        if (el.ValueKind != JsonValueKind.Object) return fallback;
        if (!el.TryGetProperty(name, out var prop)) return fallback;
        if (prop.TryGetInt32(out int v)) return v;
        return fallback;
    }

    private void Write(object payload)
    {
        string json = JsonSerializer.Serialize(payload);
        lock (_writer)
        {
            _writer.WriteLine(json);
        }
    }
}
