# Third-Party Notices (PC)

Last updated: 2026-09-18

This desktop app includes open-source software and bundled binaries.

## JavaScript/Electron Dependencies

1. `electron` v28.3.3
- License: MIT
- Local license copy: `licenses/electron.LICENSE`
- Chromium notices: `licenses/electron.chromium-licenses.html`

2. `electron-builder` v26.x
- License: MIT
- Local license copy: `licenses/electron-builder.LICENSE`

## Bundled Runtime/Binary Components

1. FFmpeg runtime
- Path: `vendor/ffmpeg/runtime/ffmpeg.exe`
- Local license copies:
  - `licenses/ffmpeg.NOTICE`
  - `licenses/ffmpeg.GPLv3`
- Compliance note: this project includes an FFmpeg license guard script before desktop distribution.

2. Whisper runtime and model
- Paths:
  - `vendor/whisper/runtime/whisper/**`
  - `vendor/whisper/model/ggml-base.en.bin`
- Local license copies:
  - `licenses/whisper.cpp.LICENSE`
  - `licenses/openai-whisper-model.LICENSE`
  - `licenses/whisper-model-provenance.md`

3. Madden OCR sidecar (experimental; disabled by default)
- Path: `ocr-sidecar/dist/gridiron-ocr-sidecar/**`
- Python 3.12 runtime: PSF License
- NumPy 2.2.6: BSD-3-Clause
- OpenCV Python Headless 4.12.0.88: Apache-2.0, with wheel third-party notices
- Pillow 11.3.0: HPND/MIT-CMU, with bundled codec/font notices
- obsws-python 1.8.0: MIT
- websocket-client 1.9.2: Apache-2.0
- pytesseract 0.3.13: Apache-2.0
- PyInstaller 6.15.0 bootloader: GPL-2.0-or-later with the PyInstaller
  bootloader exception permitting distribution of the generated application
- Tesseract 5.5 baseline runtime and English traineddata: Apache-2.0
- Leptonica and the codec/runtime libraries shipped with the Tesseract Windows
  distribution retain their BSD/MIT/zlib/IJG/other permissive notices
- Local inventory and required attributions: `licenses/OCR_RUNTIME_NOTICES.md`
- Common license texts already bundled:
  - `licenses/Apache-2.0.LICENSE`
  - `licenses/MIT.LICENSE`
- Optional ONNX Runtime recognition (`onnx_ppocrv5`):
  - Engine: ONNX Runtime (Apache-2.0) via `onnxruntime` / optional `onnxruntime-gpu`
  - Model: Hugging Face `PaddlePaddle/PP-OCRv5_mobile_rec_onnx`
    (`inference.onnx`, `inference.yml`) — **Apache-2.0** per model card
  - Not bundled by default; fetch script:
    `ocr-sidecar/scripts/fetch-pp-ocrv5-onnx.ps1`
  - When vendored under `ocr-sidecar/models/`, retain
    `ocr-sidecar/models/MODEL_LICENSE.txt` and Apache-2.0 notices
- The packaged baseline remains Tesseract (Apache-2.0). Do not ship the ONNX
  model in the NSIS payload unless the golden-dataset gate and license files
  are present.

## Distribution Checklist (PC)

1. Keep `THIRD_PARTY_NOTICES.md` and `licenses/**` in packaged output.
2. Verify FFmpeg release strategy for commercial builds.
3. Re-check any newly added runtime binary under `vendor/**`.
4. Re-run the OCR inventory after every worker rebuild and before distribution.
5. Do not add an OCR model solely because its framework is permissively
   licensed; retain explicit model provenance and license terms.
