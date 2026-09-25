import unittest

import numpy as np

from ocr_sidecar.errors import SidecarError
from ocr_sidecar.profile import crop_normalized, validate_profile


class ProfileTests(unittest.TestCase):
    def test_validates_and_crops_normalized_roi(self):
        profile = validate_profile(
            {
                "name": "scoreboard",
                "rois": [{"id": "quarter", "x": 0.25, "y": 0.2, "width": 0.5, "height": 0.6}],
            }
        )
        synthetic = np.arange(10 * 20, dtype=np.uint8).reshape((10, 20))
        crop = crop_normalized(synthetic, profile["rois"][0])
        self.assertEqual((6, 10), crop.shape)
        self.assertEqual(synthetic[2, 5], crop[0, 0])

    def test_rejects_out_of_bounds_roi(self):
        with self.assertRaisesRegex(SidecarError, "outside"):
            validate_profile(
                {
                    "name": "bad",
                    "rois": [{"id": "bad", "x": 0.8, "y": 0, "width": 0.3, "height": 1}],
                }
            )

    def test_rejects_even_blur_kernel(self):
        with self.assertRaisesRegex(SidecarError, "must be odd"):
            validate_profile(
                {
                    "name": "bad",
                    "rois": [
                        {
                            "id": "bad",
                            "x": 0,
                            "y": 0,
                            "width": 1,
                            "height": 1,
                            "preprocess": {"blur": 2},
                        }
                    ],
                }
            )


if __name__ == "__main__":
    unittest.main()
