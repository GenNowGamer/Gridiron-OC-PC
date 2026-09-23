import unittest
from unittest.mock import patch

import cv2
import numpy as np

from ocr_sidecar.engines import EngineRegistry, TesseractEngine
from ocr_sidecar.errors import SidecarError
from ocr_sidecar.obs import ObsClient


class EngineAvailabilityTests(unittest.TestCase):
    @patch("ocr_sidecar.engines.importlib.util.find_spec", return_value=None)
    def test_auto_engine_has_deterministic_unavailable_error(self, _find_spec):
        with self.assertRaises(SidecarError) as caught:
            EngineRegistry().create("auto")
        self.assertEqual("sidecar_unavailable", caught.exception.code)

    def test_explicit_mock_is_always_available(self):
        registry = EngineRegistry()
        first = registry.create("mock")
        second = registry.create("mock")
        self.assertIs(first, second)
        result = first.recognize(
            None, {"mockText": "  Nickel   Blitz ", "mockConfidence": 0.75}
        )
        self.assertEqual("Nickel Blitz", result["text"])
        self.assertEqual(0.75, result["confidence"])
        warm = registry.warm("mock")
        self.assertEqual("mock", warm["engine"])
        self.assertTrue(warm["cachedBefore"])
        self.assertEqual(["mock"], registry.status()["cached"])

    def test_missing_obs_dependency_is_graceful(self):
        obs = ObsClient(client_factory=lambda **_kwargs: (_ for _ in ()).throw(ImportError("missing")))
        with self.assertRaises(SidecarError) as caught:
            obs.configure({"host": "127.0.0.1", "port": 4455})
        self.assertEqual("obs_unavailable", caught.exception.code)

    def test_tesseract_baseline_reads_synthetic_line(self):
        image = np.full((110, 720), 255, dtype=np.uint8)
        cv2.putText(image, "3RD & 6", (25, 78), cv2.FONT_HERSHEY_SIMPLEX, 2.2, 0, 5, cv2.LINE_AA)
        try:
            result = TesseractEngine().recognize(
                image,
                {"psm": 7, "whitelist": "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&", "language": "eng"},
            )
        except SidecarError as error:
            self.skipTest(str(error))
        normalized = result["text"].upper().replace(" ", "")
        self.assertTrue(normalized.endswith("RD&6"), normalized)
        self.assertGreaterEqual(result["confidence"], 0)


if __name__ == "__main__":
    unittest.main()
