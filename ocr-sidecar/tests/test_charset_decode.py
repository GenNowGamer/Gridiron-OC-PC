'use strict';

import unittest

from ocr_sidecar.engines import _parse_character_dict, _clean_text


class CharsetDecodeTests(unittest.TestCase):
    def test_parse_character_dict_keeps_ideographic_space(self):
        yml = (
            "PostProcess:\n"
            "  name: CTCLabelDecode\n"
            "  character_dict:\n"
            "  - \u3000\n"
            "  - A\n"
            "  - B\n"
            "  - M\n"
            "  - N\n"
            "Other:\n"
            "  ignored: true\n"
        )
        chars = _parse_character_dict(yml)
        self.assertEqual(["\u3000", "A", "B", "M", "N"], chars)

    def test_strip_based_parser_would_shift_latin(self):
        # Recreates the historical bug: str.strip() drops U+3000 and shifts
        # every later class by +1 (MESH -> NFTI).
        yml = (
            "character_dict:\n"
            "  - \u3000\n"
            "  - M\n"
            "  - N\n"
        )
        chars = _parse_character_dict(yml)
        self.assertEqual("\u3000", chars[0])
        self.assertEqual("M", chars[1])
        self.assertEqual("N", chars[2])
        # CTC blank=0, model index 2 -> charset[1] == M (not N).
        self.assertEqual("M", chars[2 - 1])

    def test_clean_text_folds_fullwidth_digits(self):
        self.assertEqual("2ND & 7", _clean_text("２ＮＤ & ７"))
        self.assertEqual("MESH SPOT", _clean_text("ＭＥＳＨ　ＳＰＯＴ"))


if __name__ == "__main__":
    unittest.main()
