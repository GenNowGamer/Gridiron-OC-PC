using GridironCaptureBridge;

const string MutexName = @"Local\GridironCaptureBridgeSingleton";

using var mutex = new Mutex(true, MutexName, out bool created);
if (!created)
{
    Console.Error.WriteLine("gridiron-capture-bridge already running");
    return 2;
}

using var service = new BridgeService();

if (args.Length > 0 && args[0] == "--spike")
{
    return await RunSpikeAsync(service, args.Skip(1).ToArray());
}

using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    cts.Cancel();
};

var server = new JsonlServer(service, Console.OpenStandardInput(), Console.OpenStandardOutput());
try
{
    await server.RunAsync(cts.Token);
}
catch (OperationCanceledException)
{
    // normal shutdown
}

return 0;

static async Task<int> RunSpikeAsync(BridgeService service, string[] args)
{
    Console.Error.WriteLine("[spike] listing sources...");
    string listJson = System.Text.Json.JsonSerializer.Serialize(service.ListSources());
    Console.Error.WriteLine(listJson);

    string? sourceId = args.FirstOrDefault();
    if (string.IsNullOrWhiteSpace(sourceId))
    {
        using var doc = System.Text.Json.JsonDocument.Parse(listJson);
        foreach (var src in doc.RootElement.GetProperty("sources").EnumerateArray())
        {
            if (src.GetProperty("kind").GetString() == "capture-card")
            {
                sourceId = src.GetProperty("id").GetString();
                break;
            }
        }
    }

    if (string.IsNullOrWhiteSpace(sourceId))
    {
        Console.Error.WriteLine("[spike] no capture-card source found; pass sourceId explicitly");
        return 1;
    }

    Console.Error.WriteLine($"[spike] selecting {sourceId}");
    Console.Error.WriteLine(System.Text.Json.JsonSerializer.Serialize(service.SelectSource(sourceId)));
    await Task.Delay(500);

    const int frames = 3;
    const int samples = 20;
    var times = new List<double>(samples);
    for (int i = 0; i < samples; i++)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        ulong startSeq;
        using (var st = System.Text.Json.JsonDocument.Parse(System.Text.Json.JsonSerializer.Serialize(service.Status())))
        {
            startSeq = st.RootElement.GetProperty("sequence").GetUInt64();
        }

        ulong target = startSeq + (ulong)frames;
        while (true)
        {
            using var st = System.Text.Json.JsonDocument.Parse(System.Text.Json.JsonSerializer.Serialize(service.Status()));
            ulong seq = st.RootElement.GetProperty("sequence").GetUInt64();
            if (seq >= target) break;
            if (sw.ElapsedMilliseconds > 2000) break;
            await Task.Delay(2);
        }
        sw.Stop();
        times.Add(sw.Elapsed.TotalMilliseconds);
        await Task.Delay(80);
    }

    times.Sort();
    double p50 = Percentile(times, 0.50);
    double p95 = Percentile(times, 0.95);
    Console.Error.WriteLine($"[spike] 3-frame acquire samples={samples} p50={p50:F1}ms p95={p95:F1}ms gate=700ms");
    Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { frames, samples, p50, p95, pass = p95 <= 700 }));
    return p95 <= 700 ? 0 : 3;
}

static double Percentile(List<double> sorted, double p)
{
    if (sorted.Count == 0) return 0;
    double idx = p * (sorted.Count - 1);
    int lo = (int)Math.Floor(idx);
    int hi = (int)Math.Ceiling(idx);
    if (lo == hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
