# Gridiron OC OCR sidecar

Local Python 3.12 JSON-lines process for OCR of normalized regions from game
frames. Capture ingest is either:

- **Capture Bridge** (default) — Cap V1 shared-memory maps published by
  `GridironCaptureBridge.exe` (`adapter: "capture-bridge"`; OBS not required)
- **OBS** (legacy/manual) — WebSocket v5 screenshots and/or the native OBS
  shared-frame plugin (`adapter: "websocket"` / `"obs-plugin"`)

Transport is stdin/stdout only: one UTF-8 JSON request per line and one
schema-versioned JSON response per line. Logs must go to stderr.

## Setup and test (Windows)

For OBS legacy only: enable **Tools > WebSocket Server Settings > Enable
WebSocket server** (OBS 28+ includes WebSocket v5). Bridge path skips OBS.

```powershell
cd PC\ocr-sidecar
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m ocr_sidecar
```

`pytesseract` is only a Python adapter. Install the separate Tesseract OCR
Windows executable and ensure `tesseract.exe` is on `PATH` for fallback. Preferred
HUD engine is **`onnx_ppocrv5`** (bundled PP-OCRv5 mobile recognition ONNX).
Fetch with `scripts\fetch-pp-ocrv5-onnx.ps1` if `models\PP-OCRv5_mobile_rec`
is missing. The charset dict must preserve the leading ideographic space
(U+3000); stripping it shifts every CTC index and garbles Latin output.

PaddleOCR (full Python package) is optional and separate from the ONNX path.
Install a compatible PaddlePaddle/PaddleOCR stack separately if required; this
repository does not bundle or download Paddle models. Paddle may fetch models
during its own first initialization unless model directories are explicitly
provisioned according to PaddleOCR documentation.

When neither production engine is usable, `engine: "auto"` returns
`sidecar_unavailable`. Explicit `engine: "mock"` is deterministic and intended
only for tests/integration diagnostics; ROI `ocr.mockText` and
`ocr.mockConfidence` control its output.

## Protocol

Requests have `id`, `command`, and optional `params`. Every response has
`schemaVersion: "1.0"`, the matching `id`, and either `ok: true, result` or
`ok: false, error`. Request lines are limited to 1 MiB, decoded images to
12 MiB/3840x2160, profiles to 32 ROIs, and bursts to 30 frames.

```json
{"id":1,"command":"hello","params":{}}
{"id":2,"command":"obs.configure","params":{"host":"127.0.0.1","port":4455,"password":"..."}}
{"id":3,"command":"obs.list_sources","params":{}}
{"id":4,"command":"obs.preview","params":{"source":"Game Capture","width":960}}
{"id":5,"command":"profile.test","params":{"source":"Game Capture","engine":"tesseract","profile":{"name":"scoreboard","rois":[{"id":"quarter","x":0.45,"y":0.02,"width":0.1,"height":0.06,"preprocess":{"grayscale":true,"scale":2,"threshold":"otsu"},"ocr":{"psm":7,"whitelist":"1234OT"}}]}}}
{"id":"burst-1","command":"capture.analyze_burst","params":{"source":"Game Capture","frameCount":5,"intervalMs":100,"profile":{"name":"playcall","rois":[{"id":"defense","x":0.1,"y":0.75,"width":0.4,"height":0.1}]}}}
{"id":7,"command":"capture.cancel","params":{"requestId":"burst-1"}}
{"id":8,"command":"shutdown","params":{}}
```

`capture.analyze_burst` runs on a worker so a later `capture.cancel` can be
handled while frames are being collected. Responses can therefore arrive out
of request order. Temporal consensus groups Unicode-normalized,
case-insensitive text and reports confidence, agreement, and per-frame OCR
samples.

ROI coordinates (`x`, `y`, `width`, `height`) are normalized to 0..1 and must
remain inside the frame. Per-ROI preprocessing supports grayscale, 1x-4x
scaling, odd Gaussian blur, inversion, binary/Otsu/adaptive thresholding, and
open/close morphology.

The sidecar keeps frames and crops in memory only for the current request.
Raw image retention is disabled; no frame files are written. `obs.preview`
necessarily returns one PNG data URL to the caller but does not retain it.

## Onedir build

```powershell
.\build-sidecar.ps1
```

The script creates `.venv`, installs the pinned input, runs tests, and writes
`dist\gridiron-ocr-sidecar\gridiron-ocr-sidecar.exe`. Use `-SkipInstall` only
with an already provisioned `.venv`. The onedir folder, not just the EXE, is
the distributable.

Unpackaged Electron prefers this `.venv` (OpenCV/onnx deps) over system `py`.
Packaged installs use the onedir. Rebuild the onedir whenever capture adapters
or HUD Python change (`capture-bridge` must appear in `hello` /
`obs.configure` allowlists). Force the frozen exe in unpackaged runs with
`GRIDIRON_OCR_USE_FROZEN=1`.

## Packaging and license caveats

Before redistribution, inventory the exact wheels, native DLLs, OCR executable,
language data, Paddle runtime, and model files in the produced onedir build.
OpenCV, NumPy, Pillow, obsws-python, pytesseract, Tesseract, PaddlePaddle,
PaddleOCR, PyInstaller, and any OCR models retain their own licenses and notice
requirements. Model licenses can differ from framework licenses. This project
does not grant model redistribution rights. PyInstaller's bootloader exception
does not remove obligations imposed by bundled dependencies.
