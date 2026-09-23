# Gridiron OC PC

Desktop companion for calling offensive and defensive plays in Madden. It ranks calls from a local playbook using Tap & Speak or optional HUD capture.

Gridiron OC is an independent app. It is not affiliated with, endorsed by, or approved by Electronic Arts, EA SPORTS, the NFL, or any team.

## What is not in this repo

These stay local so a clone is not a complete copy of a running install:

- Offensive and defensive playbook files (`plays.json`, `defensive_plays.json`)
- Whisper speech models and the FFmpeg runtime
- OCR model weights, Python virtualenvs, and built installers
- API keys, app secrets, and saved preferences
- Internal session notes and one-off patch scripts

Place your own `plays.json` and `defensive_plays.json` next to `package.json` before launching.

## Run

From PowerShell, in this folder:

```powershell
npm install
npm start
```

Capture Bridge and the OCR worker are optional and build separately (`npm run build:capture-bridge`, `npm run build:ocr-worker`). See `OCR_DC_GUIDE.md` for capture setup.

## License notes

Third-party notices are in `THIRD_PARTY_NOTICES.md` and `licenses/`.
