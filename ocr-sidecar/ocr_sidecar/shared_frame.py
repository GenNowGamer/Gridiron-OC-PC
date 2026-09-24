"""Binary protocol and Windows reader for Capture Bridge shared-frame maps.

The same header layout was first used by the removed OBS plugin. Production
capture opens the Cap V1 map names. All integers are little-endian.  The control header is 32 bytes:
  0 magic[8], 8 version:u32, 12 header_size:u32, 16 source_generation:u64,
  24 source_length:u32, 28 source_capacity:u32, then UTF-8 source bytes.

The frame header is 80 bytes:
  0 magic[8], 8 version:u32, 12 header_size:u32, 16 slot_capacity:u64,
  24 sequence:u64, 32 active_slot:u32, 36 width:u32, 40 height:u32,
  44 stride:u32, 48 pixel_format:u32, 52 reserved:u32,
  56 captured_qpc:u64, 64 qpc_frequency:u64, 72 reserved:u64.
Two slot_capacity-byte BGRA buffers immediately follow the header.
Writers publish a completed inactive slot, then active_slot, then sequence.
"""

from dataclasses import dataclass
import ctypes
import os
import struct
import time

import numpy as np

from .errors import SidecarError

CONTROL_MAP_NAME = r"Local\GridironOcrObsControlV1"
FRAME_MAP_NAME = r"Local\GridironOcrObsFramesV1"
CAP_CONTROL_MAP_NAME = r"Local\GridironOcrCapControlV1"
CAP_FRAME_MAP_NAME = r"Local\GridironOcrCapFramesV1"
CONTROL_MAGIC = b"GOCCTL1\0"
FRAME_MAGIC = b"GOCFRM1\0"
PROTOCOL_VERSION = 1
PIXEL_FORMAT_BGRA8 = 1
MAX_WIDTH = 4096
MAX_HEIGHT = 2160
BYTES_PER_PIXEL = 4
SLOT_CAPACITY = MAX_WIDTH * MAX_HEIGHT * BYTES_PER_PIXEL
SOURCE_CAPACITY = 1024
CONTROL_HEADER = struct.Struct("<8sIIQII")
FRAME_HEADER = struct.Struct("<8sIIQQIIIIIIQQQ")
CONTROL_MAP_SIZE = CONTROL_HEADER.size + SOURCE_CAPACITY
FRAME_MAP_SIZE = FRAME_HEADER.size + (2 * SLOT_CAPACITY)


@dataclass
class CapturedFrame:
    image: np.ndarray
    source_sequence: int = None
    captured_qpc: int = None
    qpc_frequency: int = None
    adapter: str = "capture-bridge"
    stale: bool = False
    fallback_reason: str = None

    def metadata(self):
        captured_at = None
        if self.captured_qpc is not None and self.qpc_frequency:
            captured_at = self.captured_qpc / self.qpc_frequency
        return {
            "sourceSequence": self.source_sequence,
            "capturedQpc": self.captured_qpc,
            "qpcFrequency": self.qpc_frequency,
            "captureClockSeconds": captured_at,
            "captureAdapter": self.adapter,
            "stale": self.stale,
            "fallbackReason": self.fallback_reason,
        }


class _MappedView:
    def __init__(self, handle, address, size, kernel32):
        self.handle = handle
        self.address = address
        self.size = size
        self.kernel32 = kernel32
        self.array = (ctypes.c_ubyte * size).from_address(address)

    def __getitem__(self, key):
        if isinstance(key, slice):
            start, stop, step = key.indices(self.size)
            if step != 1:
                return bytes(self.array[key])
            return ctypes.string_at(self.address + start, stop - start)
        return self.array[key]

    def __setitem__(self, key, value):
        if isinstance(key, slice):
            start, stop, step = key.indices(self.size)
            if step != 1 or stop - start != len(value):
                raise ValueError("mapped-view assignment size mismatch")
            ctypes.memmove(self.address + start, bytes(value), len(value))
            return
        self.array[key] = value

    def close(self):
        if self.address:
            self.kernel32.UnmapViewOfFile(ctypes.c_void_p(self.address))
            self.address = 0
        if self.handle:
            self.kernel32.CloseHandle(self.handle)
            self.handle = None


class WindowsNamedMappingBackend:
    """Opens an existing mapping; unlike mmap(tagname=), never creates one."""

    FILE_MAP_ALL_ACCESS = 0x000F001F

    def open(self, name, size):
        if os.name != "nt":
            raise OSError("Windows named shared memory is only available on Windows")
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenFileMappingW.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_wchar_p]
        kernel32.OpenFileMappingW.restype = ctypes.c_void_p
        kernel32.MapViewOfFile.argtypes = [
            ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_size_t
        ]
        kernel32.MapViewOfFile.restype = ctypes.c_void_p
        kernel32.UnmapViewOfFile.argtypes = [ctypes.c_void_p]
        kernel32.UnmapViewOfFile.restype = ctypes.c_int
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle.restype = ctypes.c_int
        handle = kernel32.OpenFileMappingW(self.FILE_MAP_ALL_ACCESS, False, name)
        if not handle:
            raise OSError(ctypes.get_last_error(), f"shared memory map not found: {name}")
        address = kernel32.MapViewOfFile(handle, self.FILE_MAP_ALL_ACCESS, 0, 0, size)
        if not address:
            error = ctypes.get_last_error()
            kernel32.CloseHandle(handle)
            raise OSError(error, f"could not map shared memory: {name}")
        return _MappedView(handle, address, size, kernel32)


class SharedFrameConsumer:
    def __init__(
        self,
        backend=None,
        poll_interval=0.002,
        control_map_name=CONTROL_MAP_NAME,
        frame_map_name=FRAME_MAP_NAME,
        unavailable_code="shared_frame_unavailable",
        unavailable_message="shared-frame maps are unavailable",
        timeout_code="shared_frame_timeout",
        timeout_message="timed out waiting for a fresh shared frame",
        adapter_name="capture-bridge",
    ):
        self.backend = backend or WindowsNamedMappingBackend()
        self.poll_interval = poll_interval
        self.control_map_name = control_map_name
        self.frame_map_name = frame_map_name
        self.unavailable_code = unavailable_code
        self.unavailable_message = unavailable_message
        self.timeout_code = timeout_code
        self.timeout_message = timeout_message
        self.adapter_name = adapter_name
        self.control = None
        self.frames = None
        self.selected_source = None
        self.last_sequence = 0

    def open(self):
        if self.control is not None:
            return
        try:
            control = self.backend.open(self.control_map_name, CONTROL_MAP_SIZE)
            frames = self.backend.open(self.frame_map_name, FRAME_MAP_SIZE)
            self._validate_control(control)
            self._validate_frames(frames)
        except Exception as exc:
            for view in (locals().get("control"), locals().get("frames")):
                close = getattr(view, "close", None)
                if close:
                    close()
            raise SidecarError(
                self.unavailable_code,
                self.unavailable_message,
                {"reason": str(exc)},
            ) from exc
        self.control, self.frames = control, frames

    def _validate_control(self, view):
        magic, version, header_size, _generation, _length, capacity = CONTROL_HEADER.unpack(
            view[:CONTROL_HEADER.size]
        )
        if magic != CONTROL_MAGIC or version != PROTOCOL_VERSION:
            raise ValueError("control map magic or version mismatch")
        if header_size != CONTROL_HEADER.size or capacity != SOURCE_CAPACITY:
            raise ValueError("control map layout mismatch")

    def _validate_frames(self, view):
        values = FRAME_HEADER.unpack(view[:FRAME_HEADER.size])
        if values[0] != FRAME_MAGIC or values[1] != PROTOCOL_VERSION:
            raise ValueError("frame map magic or version mismatch")
        if values[2] != FRAME_HEADER.size or values[3] != SLOT_CAPACITY:
            raise ValueError("frame map layout mismatch")

    def select_source(self, source):
        encoded = source.encode("utf-8")
        if not encoded or len(encoded) > SOURCE_CAPACITY:
            raise SidecarError("invalid_params", "source UTF-8 encoding exceeds plugin capacity")
        self.open()
        header = list(CONTROL_HEADER.unpack(self.control[:CONTROL_HEADER.size]))
        generation = header[3] + 1
        self.control[CONTROL_HEADER.size:CONTROL_MAP_SIZE] = encoded + bytes(SOURCE_CAPACITY - len(encoded))
        self.control[:CONTROL_HEADER.size] = CONTROL_HEADER.pack(
            CONTROL_MAGIC, PROTOCOL_VERSION, CONTROL_HEADER.size,
            generation, len(encoded), SOURCE_CAPACITY,
        )
        self.selected_source = source
        return generation

    def capture(self, source, timeout_seconds=1.0):
        self.open()
        baseline = FRAME_HEADER.unpack(self.frames[:FRAME_HEADER.size])[4]
        if source != self.selected_source:
            self.select_source(source)
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            result = self._read_consistent(minimum_sequence=max(baseline, self.last_sequence) + 1)
            if result is not None:
                self.last_sequence = result.source_sequence
                return result
            time.sleep(self.poll_interval)
        raise SidecarError(
            self.timeout_code,
            self.timeout_message,
            {"source": source, "afterSequence": max(baseline, self.last_sequence)},
        )

    def _read_consistent(self, minimum_sequence):
        first = FRAME_HEADER.unpack(self.frames[:FRAME_HEADER.size])
        sequence, active = first[4], first[5]
        width, height, stride, pixel_format = first[6:10]
        if sequence < minimum_sequence:
            return None
        if active not in (0, 1) or pixel_format != PIXEL_FORMAT_BGRA8:
            return None
        if not (1 <= width <= MAX_WIDTH and 1 <= height <= MAX_HEIGHT):
            return None
        row_bytes = width * BYTES_PER_PIXEL
        if stride < row_bytes or stride * height > SLOT_CAPACITY:
            return None
        offset = FRAME_HEADER.size + active * SLOT_CAPACITY
        payload = self.frames[offset:offset + stride * height]
        second = FRAME_HEADER.unpack(self.frames[:FRAME_HEADER.size])
        if second[4] != sequence or second[5] != active or second[6:10] != first[6:10]:
            return None
        raw = np.frombuffer(payload, dtype=np.uint8).reshape(height, stride)
        bgra = raw[:, :row_bytes].reshape(height, width, BYTES_PER_PIXEL).copy()
        return CapturedFrame(
            image=bgra[:, :, :3],
            source_sequence=sequence,
            captured_qpc=first[11],
            qpc_frequency=first[12],
            adapter=self.adapter_name,
        )

    def close(self):
        for view in (self.control, self.frames):
            close = getattr(view, "close", None)
            if close:
                close()
        self.control = self.frames = None
