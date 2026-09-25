# Gridiron Capture Bridge

Bundled Windows helper for OCR frame ingest. It is the only capture path in Calibrate.

## What it does

- Enumerates **capture cards** (Media Foundation) and **PC windows** (Windows.Graphics.Capture)
- Publishes BGRA frames into Cap V1 shared memory:
  - `Local\GridironOcrCapControlV1`
  - `Local\GridironOcrCapFramesV1`
- Speaks JSONL on stdin/stdout (`hello`, `sources.list`, `source.select`, `source.status`, `preview.frame`, `shutdown`)

OCR recognition stays in the Python sidecar. Electron owns Bridge IPC (`BridgeManager`).

## Build

```powershell
cd PC\capture-bridge
.\build-bridge.ps1
```

Or from `PC`: `npm run build:capture-bridge` (also runs during `npm run dist`).

Optional Phase 0 spike (needs a live capture card):

```powershell
.\build-bridge.ps1 -Spike
```

Output: `PC\capture-bridge\dist\GridironCaptureBridge.exe`

## Capture-card notes (Elgato 4K60 Pro)

- MF capture runs on a dedicated **STA** thread (driver affinity).
- Prefer ~1080p NV12/YUY2 paths; do not enable MF video processing for realtime RGB.
- Close any other app that has the capture card open before selecting it — exclusive open fails or crashes.
- HDMI must be live for first frame / preview. Exit `3221226505` (`0xC0000409`) is typically Bridge abort, not the OCR sidecar.

## Requirements

- .NET 8 SDK (build machine)
- Windows 10 1903+ (WGC window capture)
- Self-contained publish — end users do not install .NET
