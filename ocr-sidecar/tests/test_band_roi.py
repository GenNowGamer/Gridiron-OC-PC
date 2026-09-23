import os
import unittest
from unittest.mock import patch

import cv2
import numpy as np

from ocr_sidecar.analysis import (
    _field_has_usable_structure,
    _field_read_score,
    _recognize_roi_with_band,
    analyze_frame,
)
from ocr_sidecar.engines import EngineRegistry, MockEngine
from ocr_sidecar.errors import SidecarError
from ocr_sidecar.images import expand_roi_band, locate_hud_text_crops
from ocr_sidecar.profile import validate_profile


class BandRoiTests(unittest.TestCase):
    def test_expand_roi_band_widens_and_clamps(self):
        band = expand_roi_band({"id": "down_distance", "x": 0.1, "y": 0.2, "width": 0.04, "height": 0.02})
        self.assertLess(band["x"], 0.1)
        self.assertLess(band["y"], 0.2)
        self.assertGreater(band["width"], 0.04)
        self.assertGreater(band["height"], 0.02)
        # Conservative padding — should not nearly double in both axes.
        self.assertLess(band["width"], 0.04 * 2.0)
        self.assertLessEqual(band["x"] + band["width"], 1.0)
        self.assertLessEqual(band["y"] + band["height"], 1.0)

    def test_field_has_usable_structure_for_down(self):
        self.assertTrue(_field_has_usable_structure("down_distance", "2nd & 8"))
        self.assertFalse(_field_has_usable_structure("down_distance", "1st"))
        self.assertFalse(_field_has_usable_structure("down_distance", ""))

    def test_structured_roi_skips_band_search(self):
        frame = np.zeros((120, 320, 3), dtype=np.uint8)
        cv2.putText(frame, "2ND & 8", (40, 70), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 2, cv2.LINE_AA)
        calls = {"n": 0}

        class CountingEngine(MockEngine):
            def recognize(self, image, options):
                calls["n"] += 1
                return super().recognize(image, options)

        roi = {
            "id": "down_distance",
            "x": 0.08,
            "y": 0.35,
            "width": 0.35,
            "height": 0.3,
            "preprocess": {"grayscale": True, "scale": 2, "invert": False, "threshold": "none"},
            "ocr": {"mockText": "2nd & 8", "mockConfidence": 0.92},
        }
        result = _recognize_roi_with_band(frame, roi, CountingEngine(), include_images=False)
        self.assertEqual("2nd & 8", result["text"])
        self.assertEqual("roi", result["bandSource"])
        # Structured ROI should OCR once (tight crop) and skip band candidates.
        self.assertEqual(1, calls["n"])

    def test_locate_hud_text_crops_finds_bright_strip(self):
        image = np.zeros((80, 220), dtype=np.uint8)
        cv2.putText(image, "3RD & 6", (12, 48), cv2.FONT_HERSHEY_SIMPLEX, 1.1, 255, 2, cv2.LINE_AA)
        crops = locate_hud_text_crops(image, max_crops=3)
        self.assertGreaterEqual(len(crops), 1)
        self.assertTrue(any(item.get("source") == "band_full" for item in crops))

    def test_field_read_score_prefers_structured_down(self):
        soup = _field_read_score("down_distance", "34", 0.95)
        structured = _field_read_score("down_distance", "3rd & 4", 0.8)
        self.assertGreater(structured, soup)

    def test_band_recognize_picks_structured_candidate(self):
        frame = np.zeros((120, 320, 3), dtype=np.uint8)
        cv2.putText(frame, "3RD & 6", (40, 70), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 2, cv2.LINE_AA)
        roi = {
            "id": "down_distance",
            "x": 0.08,
            "y": 0.35,
            "width": 0.35,
            "height": 0.3,
            "preprocess": {"grayscale": True, "scale": 2, "invert": False, "threshold": "none"},
            "ocr": {"mockText": "3rd & 6", "mockConfidence": 0.9},
        }
        result = _recognize_roi_with_band(frame, roi, MockEngine(), include_images=False)
        self.assertIn("3", result["text"])
        self.assertIn(result.get("bandSource"), ("roi", "band_full", "band_strip"))

    def test_analyze_frame_uses_band_path_for_situation_fields(self):
        frame = np.full((100, 200, 3), 20, dtype=np.uint8)
        profile = validate_profile(
            {
                "name": "hud",
                "rois": [
                    {
                        "id": "down_distance",
                        "x": 0.1,
                        "y": 0.1,
                        "width": 0.3,
                        "height": 0.2,
                        "preprocess": {"scale": 2},
                        "ocr": {"mockText": "2nd & 7", "mockConfidence": 0.88},
                    },
                    {
                        "id": "field_position",
                        "x": 0.5,
                        "y": 0.1,
                        "width": 0.3,
                        "height": 0.2,
                        "preprocess": {"scale": 2},
                        "ocr": {"mockText": "OWN 32", "mockConfidence": 0.9},
                    },
                ],
            }
        )
        results = analyze_frame(frame, profile, MockEngine())
        self.assertEqual("2nd & 7", results["down_distance"]["text"])
        self.assertEqual("OWN 32", results["field_position"]["text"])
        self.assertIn("bandSource", results["down_distance"])


class EnginePreferenceTests(unittest.TestCase):
    def test_auto_prefers_onnx_over_tesseract(self):
        availability = {
            "onnx_ppocrv5": True,
            "paddleocr": False,
            "tesseract": True,
            "mock": True,
        }
        with patch.object(EngineRegistry, "available", return_value=availability):
            selected = EngineRegistry().resolve_name("auto")
        self.assertEqual("onnx_ppocrv5", selected)

    def test_auto_soft_falls_back_to_tesseract_when_onnx_missing(self):
        availability = {
            "onnx_ppocrv5": False,
            "paddleocr": False,
            "tesseract": True,
            "mock": True,
        }
        with patch.object(EngineRegistry, "available", return_value=availability):
            with patch.dict("os.environ", {}, clear=False):
                os.environ.pop("GRIDIRON_OCR_ALLOW_TESSERACT", None)
                selected = EngineRegistry().resolve_name("auto")
        self.assertEqual("tesseract", selected)

    def test_auto_requires_ppocr_when_tesseract_disabled(self):
        availability = {
            "onnx_ppocrv5": False,
            "paddleocr": False,
            "tesseract": True,
            "mock": True,
        }
        with patch.object(EngineRegistry, "available", return_value=availability):
            with patch.dict("os.environ", {"GRIDIRON_OCR_ALLOW_TESSERACT": "0"}, clear=False):
                with self.assertRaises(SidecarError) as caught:
                    EngineRegistry().resolve_name("auto")
        self.assertEqual("sidecar_unavailable", caught.exception.code)


if __name__ == "__main__":
    unittest.main()
