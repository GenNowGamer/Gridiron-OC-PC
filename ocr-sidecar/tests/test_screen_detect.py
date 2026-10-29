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

    def test_input_size_follows_the_onnx_shape(self):
        self.assertEqual(1280, input_size_from_shape([1, 3, 1280, 1280]))
        self.assertEqual(640, input_size_from_shape([1, 3, "height", "width"]))
        self.assertEqual(640, input_size_from_shape(None))


if __name__ == "__main__":
    unittest.main()
