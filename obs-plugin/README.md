# Gridiron OCR OBS shared-frame plugin

Experimental, reversible OBS Studio plugin that publishes the selected source into a
local shared-memory double buffer for Gridiron OCR capture.

## Why it exists

OBS WebSocket `GetSourceScreenshot` PNG capture was too slow for the Phase 1
latency gate (full-resolution 3-frame bursts were multi-second). This plugin
keeps discovery/auth on WebSocket and moves hot-path frames to shared memory.

## Build

Requirements:

- OBS Studio 32.2.2 installed at `C:\Program Files\obs-studio`
- Visual Studio 2022 with MSVC x64 tools
- Network access once (downloads official OBS 32.2.2 source headers into `.cache/`)

```powershell
cd PC
npm run build:obs-plugin
# or:
powershell -NoProfile -ExecutionPolicy Bypass -File .\obs-plugin\build-plugin.ps1
```

Output: `PC/obs-plugin/dist/64bit/gridiron-ocr-capture.dll`

## Install

1. Quit OBS.
2. Copy `dist/64bit/gridiron-ocr-capture.dll` into:
   `C:\Program Files\obs-studio\obs-plugins\64bit\`
3. Start OBS.
4. In the OBS log, look for `[gridiron-ocr-capture] shared-frame bridge loaded`.

Uninstall by deleting that DLL and restarting OBS.

## Runtime contract

- Control map: `Local\GridironOcrObsControlV1`
- Frame map: `Local\GridironOcrObsFramesV1`
- Gridiron selects the source name through the control map.
- Frames are BGRA8, max 4096×2160, double-buffered with a monotonic sequence.

In Gridiron Settings → OCR Calibration, set **Capture adapter** to
**Native OBS plugin**.
