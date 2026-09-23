using System.Runtime.InteropServices;

namespace GridironCaptureBridge.Protocol;

internal static class CapProtocol
{
    public const string ControlMapName = @"Local\GridironOcrCapControlV1";
    public const string FrameMapName = @"Local\GridironOcrCapFramesV1";

    public static readonly byte[] ControlMagic = "GOCCTL1\0"u8.ToArray();
    public static readonly byte[] FrameMagic = "GOCFRM1\0"u8.ToArray();

    public const uint ProtocolVersion = 1;
    public const uint PixelFormatBgra8 = 1;
    public const uint MaxWidth = 4096;
    public const uint MaxHeight = 2160;
    public const uint BytesPerPixel = 4;
    public const uint SourceCapacity = 1024;
    public const ulong SlotCapacity = MaxWidth * MaxHeight * BytesPerPixel;

    public const int ControlHeaderSize = 32;
    public const int FrameHeaderSize = 80;

    public static readonly long ControlMapSize = ControlHeaderSize + SourceCapacity;
    public static readonly long FrameMapSize = FrameHeaderSize + (long)(2 * SlotCapacity);
}

[StructLayout(LayoutKind.Sequential, Pack = 1)]
internal struct ControlHeader
{
    public unsafe fixed byte Magic[8];
    public uint Version;
    public uint HeaderSize;
    public ulong SourceGeneration;
    public uint SourceLength;
    public uint SourceCapacity;
}

[StructLayout(LayoutKind.Sequential, Pack = 1)]
internal struct FrameHeader
{
    public unsafe fixed byte Magic[8];
    public uint Version;
    public uint HeaderSize;
    public ulong SlotCapacity;
    public ulong Sequence;
    public uint ActiveSlot;
    public uint Width;
    public uint Height;
    public uint Stride;
    public uint PixelFormat;
    public uint Reserved0;
    public ulong CapturedQpc;
    public ulong QpcFrequency;
    public ulong Reserved1;
}
