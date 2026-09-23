namespace GridironCaptureBridge.Sources;

internal sealed class CaptureSourceInfo
{
    public required string Id { get; init; }
    public required string Kind { get; init; }
    public required string Label { get; init; }
    public bool Available { get; init; } = true;
    public string? Hint { get; init; }
}

internal sealed class CapturedBgraFrame
{
    public required byte[] Bgra { get; init; }
    public required int Width { get; init; }
    public required int Height { get; init; }
    public required int Stride { get; init; }
}

internal interface IFrameSource : IDisposable
{
    string SourceId { get; }
    string Kind { get; }
    bool TryGetFrame(out CapturedBgraFrame frame);
    SourceRuntimeStatus GetStatus();
}

internal sealed class SourceRuntimeStatus
{
    public required string State { get; init; }
    public int Width { get; init; }
    public int Height { get; init; }
    public double? ApproximateFps { get; init; }
    public string? Message { get; init; }
    public string? Code { get; init; }
}

internal sealed class BridgeException : Exception
{
    public string Code { get; }

    public BridgeException(string code, string message) : base(message)
    {
        Code = code;
    }
}
