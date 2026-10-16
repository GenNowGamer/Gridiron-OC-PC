import threading
import time
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

    @patch("ocr_sidecar.analysis.preprocess", side_effect=lambda image, _options: image)
    def test_debug_crops_reuse_last_frame_ocr_without_recognizing_again(self, _preprocess):
        frames = [np.full((12, 16, 3), value, dtype=np.uint8) for value in (10, 20, 30)]

        class CountingEngine(MockEngine):
            def __init__(self):
                self.calls = 0

            def recognize(self, image, options):
                self.calls += 1
                return super().recognize(image, options)

        engine = CountingEngine()
        result = analyze_burst(
            lambda _source: frames.pop(0),
            "Game",
            profile(),
            engine,
            3,
            0,
            threading.Event(),
            include_images=True,
        )
        self.assertEqual(3, engine.calls)
        self.assertTrue(result["rois"]["defense"]["rawCrop"].startswith("data:image/png;base64,"))
        self.assertTrue(result["rois"]["defense"]["processedCrop"].startswith("data:image/png;base64,"))

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
                adapter="capture-bridge",
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
                    adapter="capture-bridge",
                ),
                CapturedFrame(
                    np.full((4, 4, 3), 2, dtype=np.uint8),
                    source_sequence=2,
                    captured_qpc=900,
                    qpc_frequency=1000,
                    adapter="capture-bridge",
                ),
                CapturedFrame(
                    np.full((4, 4, 3), 3, dtype=np.uint8),
                    source_sequence=3,
                    captured_qpc=1100,
                    qpc_frequency=1000,
                    adapter="capture-bridge",
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
                CapturedFrame(np.zeros((2, 2, 3), dtype=np.uint8), stale=True, adapter="capture-bridge"),
                CapturedFrame(np.ones((2, 2, 3), dtype=np.uint8), adapter="capture-bridge"),
            ]
        )
        result = benchmark_capture(lambda _source: next(frames), "Game", 2, 0)
        self.assertEqual(1, result["staleFrames"])

    def _situation_profile(self, roi_id, text, confidence=0.95, extra_rois=None):
        rois = [
            {
                "id": roi_id,
                "x": 0,
                "y": 0,
                "width": 1,
                "height": 1,
                "ocr": {"mockText": text, "mockConfidence": confidence},
            }
        ]
        rois.extend(extra_rois or [])
        return validate_profile({"name": "playcall", "rois": rois})

    def _frames(self, count=8):
        return [np.full((12, 16, 3), index + 1, dtype=np.uint8) for index in range(count)]

    @patch("ocr_sidecar.analysis.preprocess", side_effect=lambda image, _options: image)
    def test_recognition_overlaps_inter_frame_wait(self, _preprocess):
        frames = self._frames()
        starts = []

        class SlowEngine(MockEngine):
            def recognize(self, image, options):
                time.sleep(0.08)
                return super().recognize(image, options)

        def capture(_source):
            starts.append(time.monotonic())
            return frames.pop(0)

        result = analyze_burst(
            capture, "Game", profile(), SlowEngine(), 3, 100, threading.Event()
        )
        self.assertEqual(3, result["framesCaptured"])
        gap_ms = (starts[1] - starts[0]) * 1000
        # 80 ms of OCR runs inside the 100 ms spacing, so the next grab is not
        # delayed by another full recognition.
        self.assertGreaterEqual(gap_ms, 90)
        self.assertLess(gap_ms, 160)

    @patch("ocr_sidecar.analysis.preprocess", side_effect=lambda image, _options: image)
    def test_two_agreeing_situation_reads_skip_the_third_frame(self, _preprocess):
        frames = self._frames()
        result = analyze_burst(
            lambda _source: frames.pop(0),
            "Game",
            self._situation_profile("down_distance", "2nd & 8"),
            MockEngine(),
            5,
            0,
            threading.Event(),
            required_fields=["down_distance"],
        )
        self.assertEqual(2, result["framesCaptured"])
        self.assertTrue(result["adaptiveSampling"]["earlyStopped"])
        self.assertFalse(result["adaptiveSampling"]["extended"])
        self.assertEqual("2nd & 8", result["rois"]["down_distance"]["text"])
        self.assertEqual(1.0, result["rois"]["down_distance"]["agreement"])

    @patch("ocr_sidecar.analysis.preprocess", side_effect=lambda image, _options: image)
    def test_low_confidence_agreement_still_takes_a_third_frame(self, _preprocess):
        frames = self._frames()
        result = analyze_burst(
            lambda _source: frames.pop(0),
            "Game",
            self._situation_profile("down_distance", "2nd & 8", confidence=0.4),
            MockEngine(),
            5,
            0,
            threading.Event(),
            required_fields=["down_distance"],
        )
        self.assertEqual(3, result["framesCaptured"])
        self.assertFalse(result["adaptiveSampling"]["earlyStopped"])
        self.assertFalse(result["adaptiveSampling"]["extended"])

    @patch("ocr_sidecar.analysis.preprocess", side_effect=lambda image, _options: image)
    def test_disagreement_keeps_the_third_frame_and_can_extend(self, _preprocess):
        frames = self._frames()

        class Scripted(MockEngine):
            def recognize(self, _image, _options):
                return {"text": "34", "confidence": 0.95}

        result = analyze_burst(
            lambda _source: frames.pop(0),
            "Game",
            self._situation_profile("down_distance", "ignored"),
            Scripted(),
            5,
            0,
            threading.Event(),
            required_fields=["down_distance"],
        )
        self.assertEqual(5, result["framesCaptured"])
        self.assertFalse(result["adaptiveSampling"]["earlyStopped"])
        self.assertTrue(result["adaptiveSampling"]["extended"])
        self.assertEqual(["down_distance"], result["adaptiveSampling"]["extensionReasonFields"])

    @patch("ocr_sidecar.analysis.preprocess", side_effect=lambda image, _options: image)
    def test_other_roi_disagreement_blocks_early_stop(self, _preprocess):
        frames = self._frames()
        script = iter([
            ("2nd & 8", 0.95),
            ("Cover 3", 0.95),
            ("2nd & 8", 0.95),
            ("Cover 2", 0.95),
            ("2nd & 8", 0.95),
            ("Cover 3", 0.95),
        ])

        class Scripted(MockEngine):
            def recognize(self, _image, _options):
                text, confidence = next(script)
                return {"text": text, "confidence": confidence}

        hud = self._situation_profile(
            "down_distance",
            "2nd & 8",
            extra_rois=[{
                "id": "previous_defense_play",
                "x": 0, "y": 0, "width": 1, "height": 1,
                "ocr": {"mockText": "Cover 3", "mockConfidence": 0.95},
            }],
        )
        result = analyze_burst(
            lambda _source: frames.pop(0),
            "Game",
            hud,
            Scripted(),
            5,
            0,
            threading.Event(),
            required_fields=["down_distance"],
        )
        self.assertEqual(3, result["framesCaptured"])
        self.assertFalse(result["adaptiveSampling"]["earlyStopped"])

    @patch("ocr_sidecar.analysis.preprocess", side_effect=lambda image, _options: image)
    def test_field_position_bleed_risk_keeps_the_third_frame(self, _preprocess):
        frames = self._frames()
        for text in ("45", "V47", "22"):
            with self.subTest(text=text):
                result = analyze_burst(
                    lambda _source, pending=list(frames): pending.pop(0),
                    "Game",
                    self._situation_profile("field_position", text),
                    MockEngine(),
                    3,
                    0,
                    threading.Event(),
                    required_fields=["field_position"],
                )
                self.assertEqual(3, result["framesCaptured"])
                self.assertFalse(result["adaptiveSampling"]["earlyStopped"])

    @patch("ocr_sidecar.analysis.preprocess", side_effect=lambda image, _options: image)
    def test_unambiguous_field_position_stops_at_two_frames(self, _preprocess):
        frames = self._frames()
        for text in ("50", "OPP 50"):
            with self.subTest(text=text):
                pending = list(frames)
                result = analyze_burst(
                    lambda _source, pending=pending: pending.pop(0),
                    "Game",
                    self._situation_profile("field_position", text),
                    MockEngine(),
                    5,
                    0,
                    threading.Event(),
                    required_fields=["field_position"],
                )
                self.assertEqual(2, result["framesCaptured"])
                self.assertTrue(result["adaptiveSampling"]["earlyStopped"])
                self.assertEqual(text, result["rois"]["field_position"]["text"])

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
