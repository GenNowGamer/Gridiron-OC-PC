# OCR runtime license inventory

Generated/verified for the Windows onedir worker on 2026-09-17. This is an
engineering inventory, not legal advice. Preserve the upstream notices from
the exact wheels/binaries whenever the packaged versions change.

## Python worker

- CPython 3.12 — PSF License
- NumPy 2.2.6 — BSD-3-Clause. Copyright 2005-2024 NumPy Developers.
- OpenCV Python Headless 4.12.0.88 — Apache-2.0. The wheel also carries
  third-party notices in `opencv_python_headless-4.12.0.88.dist-info`.
- Pillow 11.3.0 — HPND/MIT-CMU. Copyright 1997-2011 Secret Labs AB,
  1995-2011 Fredrik Lundh and contributors, and 2010 Pillow contributors.
  Pillow's wheel includes codec/font notices that must remain available.
- obsws-python 1.8.0 — MIT.
- websocket-client 1.9.2 — Apache-2.0.
- pytesseract 0.3.13 — Apache-2.0.
- PyInstaller 6.15.0 — GPL-2.0-or-later with the upstream bootloader exception
  that permits use of the bootloader in distributed applications.
- altgraph 0.17.5 — MIT.
- packaging 26.3 — Apache-2.0 or BSD-2-Clause.
- pefile 2023.2.7 — MIT.
- pywin32-ctypes 0.2.3 — BSD-3-Clause.
- setuptools 84.0.0 — MIT.

Generic Apache-2.0 and MIT license texts are bundled beside this inventory.
The exact wheel metadata in `ocr-sidecar/.venv` is the rebuild audit source.

## Tesseract baseline

- Tesseract OCR 5.5.0.20241111 — Apache-2.0.
- English and OSD traineddata installed by the UB Mannheim Windows
  distribution — retain the distribution's model provenance.
- Leptonica 1.85.0 — BSD-2-Clause.
- Associated DLLs include libarchive, Brotli, bzip2, Cairo, FreeType, GLib,
  HarfBuzz, ICU, libjpeg-turbo, libpng, libtiff, libwebp, OpenJPEG, XZ, zlib,
  and related dependencies under their respective permissive/LGPL notices.

Required acknowledgements for the binary bundle:

- Portions of this software are copyright The FreeType Project
  (www.freetype.org). All rights reserved.
- This software is based in part on the work of the Independent JPEG Group.

Before public distribution, attach the complete notice bundle from the exact
Tesseract Windows package used to build the worker. Internal test builds may
not be represented as having completed the public-distribution license gate
until that archive is present.

## Neural model status

Optional ONNX Runtime recognition uses the official Hugging Face package
`PaddlePaddle/PP-OCRv5_mobile_rec_onnx` (`inference.onnx` + `inference.yml`).
Model card `cardData.license` is **Apache-2.0**. Binaries are **not bundled**
in git or the default installer; fetch with
`ocr-sidecar/scripts/fetch-pp-ocrv5-onnx.ps1` into gitignored
`ocr-sidecar/models/`. When model files are present under `models/`,
`models/MODEL_LICENSE.txt` must also be present (enforced by
`npm run check:ocr-license`). Prefer the CPU `onnxruntime` wheel for CI;
at runtime the engine tries CUDAExecutionProvider then CPUExecutionProvider.

Tesseract remains the default bundled baseline OCR engine for packaged builds.
PaddleOCR (Python package) stays optional and separate from the ONNX path.
