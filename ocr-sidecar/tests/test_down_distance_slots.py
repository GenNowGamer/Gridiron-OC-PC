import os
import unittest

import cv2
import numpy as np

from ocr_sidecar.analysis import _recognize_roi_with_band
from ocr_sidecar.down_distance_slots import (
    looks_like_digit_one,
    read_down_distance,
    segment_down_distance,
)

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "down_distance")


class _GarbageEngine:
    def recognize(self, _image, _options):
        return {"text": "200&11", "confidence": 0.91}


class DownDistanceSlotTests(unittest.TestCase):
    def test_labeled_broadcast_crops(self):
        expected = {
            "2nd_and_3.png": "2ND & 3",
            "3rd_and_3.png": "3RD & 3",
            "2nd_and_11.png": "2ND & 11",
            "2nd_and_16.png": "2ND & 16",
            "3rd_and_15.png": "3RD & 15",
        }
        for name, label in expected.items():
            image = cv2.imread(os.path.join(FIXTURES, name))
            self.assertIsNotNone(image, name)
            read = read_down_distance(image)
            self.assertIsNotNone(read, name)
            self.assertEqual(label, read["text"])

    def test_ambiguous_ten_falls_through_instead_of_guessing_nineteen(self):
        image = cv2.imread(os.path.join(FIXTURES, "1st_and_10_ambiguous.png"))
        self.assertIsNone(read_down_distance(image))

    def test_stem_and_base_is_a_one_and_a_three_is_not(self):
        one = np.zeros((14, 9), dtype=bool)
        one[0:5, 3:7] = True
        one[5:11, 3:7] = True
        one[11:14, :] = True
        three = np.zeros((18, 9), dtype=bool)
        three[0:4, 1:8] = True
        three[7:10, 2:8] = True
        three[14:18, 1:8] = True
        three[4:14, 5:9] = True
        self.assertTrue(looks_like_digit_one(one))
        self.assertFalse(looks_like_digit_one(three))

    def test_distant_left_marker_is_not_a_glyph(self):
        image = np.zeros((24, 90, 3), dtype=np.uint8)
        image[:, 0:2] = 220
        image[4:20, 30:58] = 230
        image[4:20, 64:76] = 230
        image[4:20, 82:90] = 230
        chunks = segment_down_distance(image)
        self.assertEqual(3, len(chunks))
        self.assertGreater(chunks[0].shape[1], 10)

    def test_slot_read_replaces_digit_soup_ocr(self):
        crop = cv2.imread(os.path.join(FIXTURES, "2nd_and_11.png"))
        height, width = crop.shape[:2]
        frame = np.zeros((120, 240, 3), dtype=np.uint8)
        frame[40:40 + height, 20:20 + width] = crop
        roi = {
            "id": "down_distance",
            "x": 20 / 240,
            "y": 40 / 120,
            "width": width / 240,
            "height": height / 120,
            "preprocess": {"grayscale": True, "scale": 3, "invert": True, "threshold": "otsu"},
        }
        result = _recognize_roi_with_band(frame, roi, _GarbageEngine())
        self.assertEqual("2ND & 11", result["text"])
        self.assertEqual("slot_recognizer", result["bandSource"])


if __name__ == "__main__":
    unittest.main()
