import unittest

import numpy as np

from ocr_sidecar.analysis import temporal_consensus
from ocr_sidecar.images import detect_field_side_arrow


def _draw_triangle(image, direction, left, top, size):
    mid = left + size // 2
    for y in range(size):
        t = y / max(1, size - 1)
        if direction == "down":
            half = int(round((1.0 - t) * (size // 2 - 2)))
        else:
            half = int(round(t * (size // 2 - 2)))
        if half <= 0:
            continue
        row = top + y
        image[row, mid - half : mid + half + 1] = 255


def _draw_digit_block(image, left, top, width, height):
    """Solid block approximating bright HUD yard digits (larger than the arrow)."""
    image[top : top + height, left : left + width] = 230
    # Punch a couple of holes so the digit contour is more complex than a triangle.
    gap = max(2, width // 5)
    image[top + height // 4 : top + (3 * height) // 4, left + gap : left + 2 * gap] = 0
    image[top + height // 5 : top + (4 * height) // 5, left + width - 2 * gap : left + width - gap] = 0


def _triangle(direction, size=32):
    image = np.zeros((size, size), dtype=np.uint8)
    _draw_triangle(image, direction, 0, 0, size)
    # Place arrow on the left of a dark digit-like block to mimic TNF HUD crop.
    canvas = np.zeros((size, size * 2), dtype=np.uint8)
    canvas[:, :size] = image
    canvas[8 : size - 8, size + 6 : size * 2 - 4] = 220
    return canvas


def _digit_dominant_crop(direction, height=48, width=96):
    """
    Mimic the live OWN/OPP 34 crop: small left triangle + much larger digit ink.
    The old detector picked max(contourArea) and missed the arrow.
    """
    canvas = np.zeros((height, width), dtype=np.uint8)
    arrow = max(18, height // 2)
    _draw_triangle(canvas, direction, 2, (height - arrow) // 2, arrow)
    digit_w = width // 2
    digit_h = int(height * 0.78)
    _draw_digit_block(
        canvas,
        left=width - digit_w - 4,
        top=(height - digit_h) // 2,
        width=digit_w,
        height=digit_h,
    )
    return canvas


class FieldSideArrowTests(unittest.TestCase):
    def test_down_arrow_maps_to_own(self):
        result = detect_field_side_arrow(_triangle("down"))
        self.assertEqual("OWN", result["side"])
        self.assertEqual("down", result["direction"])
        self.assertGreaterEqual(result["confidence"], 0.40)

    def test_up_arrow_maps_to_opp(self):
        result = detect_field_side_arrow(_triangle("up"))
        self.assertEqual("OPP", result["side"])
        self.assertEqual("up", result["direction"])
        self.assertGreaterEqual(result["confidence"], 0.40)

    def test_digit_dominant_down_arrow_still_own(self):
        result = detect_field_side_arrow(_digit_dominant_crop("down"))
        self.assertEqual("OWN", result["side"])
        self.assertEqual("down", result["direction"])
        self.assertGreaterEqual(result["confidence"], 0.40)

    def test_digit_dominant_up_arrow_still_opp(self):
        result = detect_field_side_arrow(_digit_dominant_crop("up"))
        self.assertEqual("OPP", result["side"])
        self.assertEqual("up", result["direction"])
        self.assertGreaterEqual(result["confidence"], 0.40)

    def test_digits_only_returns_none(self):
        canvas = np.zeros((40, 80), dtype=np.uint8)
        _draw_digit_block(canvas, 20, 6, 40, 28)
        result = detect_field_side_arrow(canvas)
        self.assertIsNone(result["side"])

    def test_empty_image_returns_none(self):
        result = detect_field_side_arrow(np.zeros((8, 8), dtype=np.uint8))
        self.assertIsNone(result["side"])

    def test_temporal_consensus_includes_field_side(self):
        result = temporal_consensus(
            [
                {"text": "35", "confidence": 0.8, "fieldSide": "OWN", "fieldSideConfidence": 0.9},
                {"text": "35", "confidence": 0.7, "fieldSide": "OWN", "fieldSideConfidence": 0.8},
                {"text": "35", "confidence": 0.6, "fieldSide": "OPP", "fieldSideConfidence": 0.5},
            ]
        )
        self.assertEqual("35", result["text"])
        self.assertEqual("OWN", result["fieldSide"])
        self.assertEqual("down", result["fieldSideDirection"])


if __name__ == "__main__":
    unittest.main()
