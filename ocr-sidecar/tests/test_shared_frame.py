import threading
import time
import unittest

import numpy as np

from ocr_sidecar.errors import SidecarError
from ocr_sidecar.shared_frame import (
    CAP_CONTROL_MAP_NAME,
    CAP_FRAME_MAP_NAME,
    CONTROL_HEADER,
    CONTROL_MAGIC,
    CONTROL_MAP_NAME,
    CONTROL_MAP_SIZE,
    FRAME_HEADER,
    FRAME_MAGIC,
    FRAME_MAP_NAME,
    FRAME_MAP_SIZE,
    PIXEL_FORMAT_BGRA8,
    PROTOCOL_VERSION,
    SLOT_CAPACITY,
    SOURCE_CAPACITY,
    CapturedFrame,
    SharedFrameConsumer,
)


class MemoryBackend:
    def __init__(self):
        self.maps = {
            CONTROL_MAP_NAME: bytearray(CONTROL_MAP_SIZE),
            FRAME_MAP_NAME: bytearray(FRAME_MAP_SIZE),
        }
        self.maps[CONTROL_MAP_NAME][:CONTROL_HEADER.size] = CONTROL_HEADER.pack(
            CONTROL_MAGIC, PROTOCOL_VERSION, CONTROL_HEADER.size, 0, 0, SOURCE_CAPACITY
        )
        self.maps[FRAME_MAP_NAME][:FRAME_HEADER.size] = FRAME_HEADER.pack(
            FRAME_MAGIC, PROTOCOL_VERSION, FRAME_HEADER.size, SLOT_CAPACITY,
            0, 0, 0, 0, 0, PIXEL_FORMAT_BGRA8, 0, 0, 10_000_000, 0,
        )

    def open(self, name, _size):
        return self.maps[name]


class UnavailableBackend:
    def open(self, _name, _size):
        raise FileNotFoundError("plugin mapping absent")


def publish_when_selected(backend, generations):
    control = backend.maps[CONTROL_MAP_NAME]
    frames = backend.maps[FRAME_MAP_NAME]
    handled = 0
    while handled < generations:
        header = CONTROL_HEADER.unpack(control[:CONTROL_HEADER.size])
        if header[3] <= handled:
            time.sleep(0.001)
            continue
        source = bytes(control[CONTROL_HEADER.size:CONTROL_HEADER.size + header[4]]).decode("utf-8")
        sequence = handled + 1
        color = 10 if source == "Gameplay" else 20
        width, height, stride, active = 2, 2, 8, sequence % 2
        offset = FRAME_HEADER.size + active * SLOT_CAPACITY
        frames[offset:offset + 16] = bytes([color, 2, 3, 255] * 4)
        frames[:FRAME_HEADER.size] = FRAME_HEADER.pack(
            FRAME_MAGIC, PROTOCOL_VERSION, FRAME_HEADER.size, SLOT_CAPACITY,
            sequence, active, width, height, stride, PIXEL_FORMAT_BGRA8,
            0, sequence * 100, 10_000_000, 0,
        )
        handled += 1


class SharedFrameTests(unittest.TestCase):
    def test_unavailable_plugin_is_structured_error(self):
        consumer = SharedFrameConsumer(backend=UnavailableBackend())
        with self.assertRaises(SidecarError) as raised:
            consumer.capture("Gameplay", 0.01)
        self.assertEqual("shared_frame_unavailable", raised.exception.code)

    def test_source_switch_waits_for_fresh_sequence_and_decodes_bgra(self):
        backend = MemoryBackend()
        consumer = SharedFrameConsumer(backend=backend, poll_interval=0.0005)
        writer = threading.Thread(target=publish_when_selected, args=(backend, 2), daemon=True)
        writer.start()
        first = consumer.capture("Gameplay", 0.5)
        second = consumer.capture("Menu", 0.5)
        writer.join(0.5)

        self.assertEqual(1, first.source_sequence)
        self.assertEqual(2, second.source_sequence)
        self.assertEqual([10, 2, 3], first.image[0, 0].tolist())
        self.assertEqual([20, 2, 3], second.image[0, 0].tolist())
        control = CONTROL_HEADER.unpack(backend.maps[CONTROL_MAP_NAME][:CONTROL_HEADER.size])
        selected = bytes(
            backend.maps[CONTROL_MAP_NAME][CONTROL_HEADER.size:CONTROL_HEADER.size + control[4]]
        ).decode("utf-8")
        self.assertEqual("Menu", selected)

    def test_same_source_does_not_republish_control_generation(self):
        backend = MemoryBackend()
        consumer = SharedFrameConsumer(backend=backend, poll_interval=0.0005)
        consumer.open()
        consumer.selected_source = "Gameplay"
        consumer._read_consistent = lambda minimum_sequence: CapturedFrame(
            image=np.zeros((2, 2, 3), dtype=np.uint8),
            source_sequence=minimum_sequence,
            adapter="capture-bridge",
        )
        consumer.capture("Gameplay", 0.5)

        generation = CONTROL_HEADER.unpack(
            backend.maps[CONTROL_MAP_NAME][:CONTROL_HEADER.size]
        )[3]
        self.assertEqual(0, generation)
        self.assertEqual("Gameplay", consumer.selected_source)

    def test_capture_bridge_maps_use_cap_names(self):
        backend = MemoryBackend()
        backend.maps[CAP_CONTROL_MAP_NAME] = backend.maps[CONTROL_MAP_NAME]
        backend.maps[CAP_FRAME_MAP_NAME] = backend.maps[FRAME_MAP_NAME]
        consumer = SharedFrameConsumer(
            backend=backend,
            control_map_name=CAP_CONTROL_MAP_NAME,
            frame_map_name=CAP_FRAME_MAP_NAME,
            unavailable_code="capture_bridge_unavailable",
            timeout_code="capture_bridge_frame_timeout",
            adapter_name="capture-bridge",
        )
        thread = threading.Thread(target=publish_when_selected, args=(backend, 1), daemon=True)
        thread.start()
        frame = consumer.capture("Gameplay", 1.0)
        self.assertEqual("capture-bridge", frame.adapter)
        thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
