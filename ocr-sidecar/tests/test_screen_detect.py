import time
import unittest

import numpy as np

from ocr_sidecar.screen_detector import input_size_from_shape, parse_predictions
from ocr_sidecar.service import SidecarService


class ScreenDetectTests(unittest.TestCase):
    def test_missing_model_is_not_trained(self):
        service = SidecarService()
        empty = service.execute("screen.detect", {"modelPath": ""})
        missing = service.execute("screen.detect", {"modelPath": "C:/no/such/screen-detector.onnx"})
        for result in (empty, missing):
            self.assertFalse(result["trained"])
            self.assertEqual("not_trained", result["reason"])
            self.assertEqual([], result["boxes"])
            self.assertFalse(result["playCall"])

    def test_parse_yolo_row_maps_back_to_the_frame(self):
        row = np.zeros((1, 9), dtype=np.float32)
        row[0, 0] = 160
        row[0, 1] = 320
        row[0, 2] = 320
        row[0, 3] = 640
        row[0, 4] = 0.92
        boxes = parse_predictions(row, scale=1, pad_x=0, pad_y=0, orig_w=640, orig_h=640)
        self.assertEqual(1, len(boxes))
        self.assertEqual("down_distance", boxes[0]["field"])
        self.assertAlmostEqual(0.0, boxes[0]["x"], places=3)
        self.assertAlmostEqual(0.5, boxes[0]["width"], places=3)
        self.assertAlmostEqual(0.92, boxes[0]["confidence"], places=3)

    def test_parse_yolo_grid_keeps_the_best_box(self):
        grid = np.zeros((1, 9, 33600), dtype=np.float32)
        grid[0, 0, 10] = 100
        grid[0, 1, 10] = 100
        grid[0, 2, 10] = 40
        grid[0, 3, 10] = 20
        grid[0, 4, 10] = 0.4
        grid[0, 0, 30000] = 200
        grid[0, 1, 30000] = 100
        grid[0, 2, 30000] = 80
        grid[0, 3, 30000] = 40
        grid[0, 4, 30000] = 0.91
        started = time.perf_counter()
        boxes = parse_predictions(grid, scale=1, pad_x=0, pad_y=0, orig_w=1280, orig_h=720, size=1280)
        elapsed = time.perf_counter() - started
        self.assertLess(elapsed, 0.5)
        self.assertEqual(["down_distance"], [box["field"] for box in boxes])
        self.assertAlmostEqual(0.91, boxes[0]["confidence"], places=3)
        self.assertAlmostEqual((200 - 40) / 1280, boxes[0]["x"], places=3)

    def test_equal_confidence_keeps_the_earlier_box(self):
        rows = np.zeros((2, 6), dtype=np.float32)
        rows[0] = (10, 10, 40, 30, 0.8, 1)
        rows[1] = (20, 10, 50, 30, 0.8, 1)
        boxes = parse_predictions(rows, scale=1, pad_x=0, pad_y=0, orig_w=100, orig_h=100)
        self.assertEqual(1, len(boxes))
        self.assertEqual("field_position", boxes[0]["field"])
        self.assertAlmostEqual(0.1, boxes[0]["x"], places=3)

    def test_input_size_follows_the_onnx_shape(self):
        self.assertEqual(1280, input_size_from_shape([1, 3, 1280, 1280]))
        self.assertEqual(640, input_size_from_shape([1, 3, "height", "width"]))
        self.assertEqual(640, input_size_from_shape(None))


if __name__ == "__main__":
    unittest.main()
