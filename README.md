# Gridiron OC PC

Desktop companion for calling offensive and defensive plays currently (only) works with Madden 26. It ranks calls from a local playbook using Tap & Speak or optional HUD capture.

Gridiron OC is an independent app. It is not affiliated with, endorsed by, or approved by Electronic Arts, EA SPORTS, the NFL, or any team.

## Included

- Offensive and defensive playbooks (`plays.json`, `defensive_plays.json`)
- Whisper speech models and runtime, plus the FFmpeg runtime
- OCR model weights, the OCR Python virtualenv, and the packaged OCR worker
- Capture Bridge (`capture-bridge/dist/GridironCaptureBridge.exe`)
- Windows setup installer (`dist/Gridiron Play Advisor Setup 0.1.1.exe`)

The base Whisper model and the setup installer are stored with Git LFS. Install [Git LFS](https://git-lfs.com/) before cloning, or those two files will be pointer text instead of the real binaries.

FFmpeg in this repo is GPL-enabled. Notices are in `licenses/ffmpeg.NOTICE` and `licenses/ffmpeg.GPLv3`.

## What is not in this repo

- API keys, app secrets, and saved preferences
- Internal session notes and one-off patch scripts
- electron-builder unpack and staging folders, which repeat the setup installer

## Run

From PowerShell, in this folder:

```powershell
npm install
npm start
```

Capture Bridge and the OCR worker are optional and build separately (`npm run build:capture-bridge`, `npm run build:ocr-worker`). See `OCR_DC_GUIDE.md` for capture setup.

## License notes

Third-party notices are in `THIRD_PARTY_NOTICES.md` and `licenses/`.

Minimum System Requirements:

Windows 10 version 2004, 64-bit, or Windows 11
A 4-thread 64-bit CPU
8 GB RAM
No discrete graphics card
About 2 GB of free disk space

Recommended System Requirements

A 4-core 64-bit CPU
16 GB RAM
No discrete graphics card needed
About 2 GB of free disk space
