import threading
import unittest
from unittest.mock import patch

import numpy as np

from ocr_sidecar.analysis import analyze_burst, benchmark_capture, temporal_consensus
from ocr_sidecar.engines import MockEngine
from ocr_sidecar.errors import SidecarError
from ocr_sidecar.profile import validate_profile
from ocr_sidecar.shared_frame import CapturedFrame


def profile(mock_text="Cover 3"):
    return validate_profile(
        {
            "name": "playcall",
            "rois": [
                {
                    "id": "defense",
                    "x": 0,
                    "y": 0,
                    "width": 1,
                    "height": 1,
                    "ocr": {"mockText": mock_text, "mockConfidence": 0.9},
                }
            ],
        }
    )


class AnalysisTests(unittest.TestCase):
    def test_temporal_consensus_normalizes_case_and_whitespace(self):
        result = temporal_consensus(
            [
                {"text": "Cover  3", "confidence": 0.8},
                {"text": "cover 3", "confidence": 0.9},
                {"text": "Cover 2", "confidence": 1.0},
            ]
        )
        self.assertEqual("cover 3", result["text"])
        self.assertEqual(0.6667, result["agreement"])
        self.assertEqual(0.85, result["confidence"])

    def test_down_distance_consensus_prefers_structure_over_digit_soup(self):
        result = temporal_consensus(
            [
                {"text": "34", "confidence": 0.95},
                {"text": "34", "confidence": 0.94},
                {"text": "3rd & 4", "confidence": 0.8},
            ],
            roi_id="down_distance",
        )
        self.assertEqual("3rd & 4", result["text"])

    def test_field_position_consensus_drops_leading_digit_bleed(self):
        result = temporal_consensus(
            [
                {"text": "45", "confidence": 0.95},
                {"text": "45", "confidence": 0.94},
                {"text": "5", "confidence": 0.8},
            ],
            roi_id="field_position",
        )
        self.assertEqual("5", result["text"])

    @patch("ocr_sidecar.analysis.preprocess", side_effect=lambda image, _options: image)
    def test_burst_uses_synthetic_frames_without_retaining_them(self, _preprocess):
        frames = [np.full((12, 16, 3), value, dtype=np.uint8) for value in (10, 20, 30)]
        result = analyze_burst(
            lambda _source: frames.pop(0),
            "Game",
            profile(),
            MockEngine(),
            3,
            0,
            threading.Event(),
        )
        self.assertEqual(3, result["framesCaptured"])
        self.assertEqual("Cover 3", result["rois"]["defense"]["text"])
        self.assertFalse(result["rawFramesRetained"])
        self.assertFalse(result["includeImages"])
        defense = result["rois"]["defense"]
        self.assertNotIn("rawCrop", defense)
        self.assertNotIn("processedCrop", defense)
        self.assertNotIn("data:image", str(result).lower())

    def test_capture_benchmark_reports_hashes_and_duplicates(self):
        frame = np.full((12, 16, 3), 42, dtype=np.uint8)
        result = benchmark_capture(lambda _source: frame.copy(), "Game", 3, 0)
        self.assertEqual(3, result["framesCaptured"])
        self.assertEqual(3, len(result["frameHashes"]))
        self.assertEqual(2, result["duplicateFrames"])
        self.assertEqual(16, result["frames"][0]["width"])
        self.assertFalse(result["rawFramesRetained"])

    @patch("ocr_sidecar.analysis.preprocess", side_effect=lambda image, _options: image)
    def test_burst_suppresses_duplicate_plugin_sequences(self, _preprocess):
        sequences = iter((1, 1, 2))

        def capture(_source):
            sequence = next(sequences)
            return CapturedFrame(
                np.full((4, 4, 3), sequence, dtype=np.uint8),
                source_sequence=sequence,
                adapter="obs-plugin",
            )

        result = analyze_burst(
            capture, "Game", profile(), MockEngine(), 2, 0, threading.Event()
        )
        self.assertEqual(2, result["framesCaptured"])
        self.assertEqual(1, result["duplicateFrames"])
        self.assertEqual([1, 2], [item["sourceSequence"] for item in result["frames"]])

    @patch("ocr_sidecar.analysis.preprocess", side_effect=lambda image, _options: image)
    def test_burst_counts_stale_qpc_regression(self, _preprocess):
        payloads = iter(
            [
                CapturedFrame(
                    np.full((4, 4, 3), 1, dtype=np.uint8),
                    source_sequence=1,
                    captured_qpc=1000,
                    qpc_frequency=1000,
                    adapter="obs-plugin",
                ),
                CapturedFrame(
                    np.full((4, 4, 3), 2, dtype=np.uint8),
                    source_sequence=2,
                    captured_qpc=900,
                    qpc_frequency=1000,
                    adapter="obs-plugin",
                ),
                CapturedFrame(
                    np.full((4, 4, 3), 3, dtype=np.uint8),
                    source_sequence=3,
                    captured_qpc=1100,
                    qpc_frequency=1000,
                    adapter="obs-plugin",
                ),
            ]
        )

        result = analyze_burst(
            lambda _source: next(payloads),
            "Game",
            profile(),
            MockEngine(),
            2,
            0,
            threading.Event(),
        )
        self.assertEqual(2, result["framesCaptured"])
        self.assertGreaterEqual(result["staleFrames"], 1)
        self.assertEqual([1, 3], [item["sourceSequence"] for item in result["frames"]])

    def test_benchmark_counts_explicit_stale_metadata(self):
        frames = iter(
            [
                CapturedFrame(np.zeros((2, 2, 3), dtype=np.uint8), stale=True, adapter="obs-plugin"),
                CapturedFrame(np.ones((2, 2, 3), dtype=np.uint8), adapter="obs-plugin"),
            ]
        )
        result = benchmark_capture(lambda _source: next(frames), "Game", 2, 0)
        self.assertEqual(1, result["staleFrames"])

    def test_cancelled_burst_does_not_capture(self):
        event = threading.Event()
        event.set()
        with self.assertRaisesRegex(SidecarError, "cancelled"):
            analyze_burst(
                lambda _source: np.zeros((2, 2), dtype=np.uint8),
                "Game",
                profile(),
                MockEngine(),
                2,
                0,
                event,
            )


if __name__ == "__main__":
    unittest.main()
