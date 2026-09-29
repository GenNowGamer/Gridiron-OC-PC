# Gridiron OC (PC)

[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2B%20%7C%20Electron-blue.svg)](#system-requirements)
[![Version](https://img.shields.io/badge/Version-0.1.8-green.svg)](#testing--quality-verification)
[![License](https://img.shields.io/badge/License-Proprietary-red.svg)](#license--trademarks)

**Gridiron OC** is a desktop smart play-calling companion for football video games (such as Madden NFL) and real-time football simulation. Designed for both Offense and Defense, it serves as an intelligent coordinator assistant that surfaces high-probability, context-aware play recommendations in real time.

Gridiron OC operates completely on-device with zero cloud dependencies, utilizing local speech recognition and low-latency video capture to deliver seamless coordinator intelligence.

---

## Table of Contents

- [Core Purpose & Value Proposition](#core-purpose--value-proposition)
- [Key Features](#key-features)
  - [Offensive Coordinator (OC) Workspace](#1-offensive-coordinator-oc-workspace)
  - [Defensive Coordinator (DC) Workspace](#2-defensive-coordinator-dc-workspace)
  - [Hands-Free Input: Speech & Vision](#3-hands-free-input-speech--vision)
  - [Game Management & Flow Controls](#4-game-management--flow-controls)
  - [Opponent Scouting & Tendencies](#5-opponent-scouting--tendencies)
  - [Post-Game Coordinator Report](#6-post-game-coordinator-report)
- [How to Use Gridiron OC](#how-to-use-gridiron-oc)
  - [Voice Workflow](#voice-first-workflow-recommended)
  - [OCR Screen Ingest Workflow](#ocr-screen-capture-workflow)
- [System Architecture](#system-architecture)
- [Installation & Setup](#installation--setup)
- [Testing & Quality Verification](#testing--quality-verification)
- [Security & Privacy Standards](#security--privacy-standards)
- [License & Trademarks](#license--trademarks)

---

## Core Purpose & Value Proposition

In competitive football gaming, calling plays under a running play clock can lead to repetitive tendencies, panic calls, or playbook fatigue. **Gridiron OC solves this by acting as your virtual coordinator**:

1. **Eliminates Repetitive Play-Calling:** Multi-tiered anti-repeat algorithms and formation rotation ensure you stay unpredictable while maintaining sound football concepts.
2. **Context-Aware Strategy:** Understands down, distance, yard line, score differential, clock urgency, and opponent habits.
3. **Dual-Sided Mastery:** Seamlessly switch between offensive playbook mastery and defensive package counters.
4. **Adaptive Personal Learning:** Learns which concepts succeed or fail against specific looks across your games.
5. **Zero Lag & Complete Privacy:** Runs 100% locally on your machine with offline Whisper speech recognition and local computer vision.

---

## Key Features

### 1. Offensive Coordinator (OC) Workspace

- **Top-3 Recommendation Slate:** Evaluates your entire 32-team NFL playbook catalog and presents the 3 best calls for the exact down, distance, and field spot.
- **Why-This-Call Chips:** Every recommendation tile displays live contextual rationales (e.g., *Identity Fit*, *Sets up Play-Action*, *Coverage Beater*, *Third-Down Converter*).
- **Playcalling Modes:** Instantly reshape your playbook strategy with specialized tactical overlays:
  - **Normal:** Balanced, situation-driven adaptive play calling.
  - **2 Minute Drill:** Prioritizes sideline access, quick yardage, and hurry-up pass concepts.
  - **Kill Clock:** Favors interior runs, clock-chewing concepts, and conservative pass options.
  - **Comeback:** Aggressive chunk-play hunting with deep intermediate pass concepts.
  - **Blitz Beater:** Hot throws, screens, draws, and quick perimeter answers that neutralize blitzes.
  - **Redzone:** Short-field spacing concepts (smash, snag, mesh, duo, power, and RPO).
- **Setup-to-Payoff Engine:** Tracks conceptual sequencing across drives (e.g., establishing inside zone to unlock explosive play-action bootlegs later in the series).
- **Exploration & Variety Engine:** Samples near-tie optimal calls so you aren't always handed the identical play in similar down/distance situations.

### 2. Defensive Coordinator (DC) Workspace

- **Comprehensive Defensive Catalog:** Includes all 32 NFL teams and over 8,200 unique defensive plays across 3-4, 4-3, Nickel, Dime, Dollar, and Goal Line fronts.
- **Realistic Blitz & Pressure Balancing:** Delivers authentic NFL pressure rates (~25%–35%) with fine-grained classification between disguised `zone_blitz` and aggressive `man_blitz`.
- **Sticky "Offense Showing" Biasing:** Quickly tap the opponent's offensive formation (e.g., *Gun Bunch*, *Singleback Wing*, *I-Form*) to bias defensive recommendations toward optimal personnel groupings.
- **Strict Situation Gating:**
  - *Goal Line Fronts:* Enforced strictly on goal-to-go inside 3 yards or critical short-yardage downs.
  - *Prevent Packages:* Restricted to Hail Mary situations or protect-the-lead late-game scenarios.
- **Exact Calls vs. Package Calls:** Receive high-level package concepts or exact play calls matched directly to your current defensive playbook.

### 3. Hands-Free Input: Speech & Vision

- **Local Whisper Speech Recognition:**
  - Press the mic button and speak natural football situations (e.g., *"3rd and 6"*, *"1st and goal on the 4"*, *"2nd and 8 cover 3"*).
  - Robust parser handles natural speech, ordinals, yard-line phrasing (*"on my own 30"*, *"at the 50"*), and common STT homophones.
- **Local Computer Vision (Madden OCR DC):**
  - Connects to your gameplay via the bundled **Gridiron Capture Bridge** (compatible with PC window capture or Elgato capture cards).
  - Automatically reads the on-screen scoreboard (down, distance, yard line, and upcoming offensive formation) without sending video data to external servers.
  - Calibrates to major broadcast presentation styles (Default, TNF, MNF, SNF).

### 4. Game Management & Flow Controls

- **Interactive Game Scoreboard & Automatic Scoring:**
  - Track and adjust score (*You / Opp*) and quarter (*Q1–Q4, OT*) directly on both the OC and DC call sheets with zero desync.
  - Automatically factors score differential and remaining time into coordinator play-calling aggression and defensive shell eligibility.
  - **Drive Result & Game State Scoring Integration:** Selecting scoring outcomes in OC or DC Game State automatically updates the scoreboard:
    - *Touchdown (OC / DC):* Automatically awards 6 points and triggers a streamlined, transparent modal overlay prompting for extra point attempts (+1 PAT, +2 Two-Point Conversion, or 0 Missed/None).
    - *Field Goal:* Automatically awards 3 points to the scoring side.
    - *Safety:* Automatically awards 2 points to the defending side.
    - *Pick 6 / Scoop & Score:* Automatically awards 6 points to the recovering side with the same transparent PAT overlay.
- **Halftime Adjustments:**
  - Unlock mid-game coordinator style adjustments at the half without erasing accumulated opponent scouting or game drive history.
- **Audible Overlay:**
  - If you audible at the line of scrimmage, swap your confirmed play to the actual play executed from the same formation/set so your learning model stays accurate.
- **Penalty Tracking:**
  - Stamp Madden flags (*holding, pass interference, false start*) to ensure penalized snaps do not corrupt your playbook success metrics.
- **Drive Result Tracking & Coordinator Handoff:**
  - Log possession outcomes (*Touchdown, Field Goal, Punt, Turnover, Sack*) to reinforce situational learning and automatically hand off between OC and DC workspaces.

### 5. Opponent Scouting & Tendencies

- **Last Defense Shown Bar:**
  - With a single tap, record the coverage shell the defense ran (*Blitz, Man, C1, C2, C3, C4, C6, C9, Tampa 2*).
  - Builds a multi-game tendency database against human opponents or CPU profiles.
- **Predictive Pre-Snap Layering:**
  - When the defensive look is unknown, Gridiron OC predicts the opponent's likely coverage based on historical tendencies in that down/distance and biases offensive calls accordingly.

### 6. Post-Game Coordinator Report

At the conclusion of each match, select **End Game** to view a comprehensive analytical debrief:
- **Trust & Fidelity Scores:** Evaluates how consistently you executed the coordinator's recommendations.
- **Success Leaders:** Pinpoints your most effective plays and concepts (requiring minimum sample sizes).
- **Scouting Matchup Breakdown:** Details how often your offensive calls exploited the opponent's defensive tendencies.
- **Learned Adjustments:** Summarizes strategic tweaks stored for future matchups against this opponent.

---

## How to Use Gridiron OC

### Voice-First Workflow (Recommended)

1. **Launch App:** Start Gridiron OC and select your team and your opponent in **Settings**.
2. **Select Coordinator Role:** Toggle between **OC** (Offense) and **DC** (Defense) on the top bar.
3. **Start Game:** Click **New Game** to initialize the scoreboard and drive memory.
4. **Call the Situation:**
   - Tap **Tap & Speak Situation** (or use your configured push-to-talk hotkey).
   - Say the down and field location: *"3rd and 7 on the opponent 35"*.
5. **Execute & Confirm:**
   - Review your top 3 recommended plays.
   - Click the checkmark on the play you ran to log the confirmation.
   - *(Optional)* If you changed the play at the line, tap **Audible**. If a flag was thrown, tap **Penalty**.
6. **Log Coverage:** Tap the defense you faced on the **Last Defense Shown** bar.
7. **End Drive / Game:** When possession ends, select **Game State** to record the drive outcome, or **End Game** at the final whistle to view your report.

### OCR Screen Capture Workflow

1. In **Settings**, open **Calibrate capture** and select your capture card or Madden PC window.
2. Select your broadcast presentation style (e.g., *Default Presentation* or *Thursday Night Football*).
3. Align the ROI crop boxes with your broadcast scoreboard and test the profile.
4. Enable **OCR Capture** in Settings.
5. In game, press the capture hotkey (`Ctrl+Shift+D` by default). Gridiron OC will parse the live situation and surface play calls instantly.

---

## System Architecture

Gridiron OC is built on an isolated, modular architecture designed for high stability and real-time execution:

```
[ Electron Main Process (main.js) ]
       │
       ├── IPC Bridge (preload.js)
       │
[ Renderer Workspace (app.js, index.html) ]
       ├── Adaptive Recommendation Core (shared/recommendationCore.js)
       ├── Defense Scorer (shared/defenseRecommendationCore.js)
       ├── Stage-2 Slate Builder (shared/selectionEngine.js)
       ├── End Game Report Builder (shared/coordinatorReport.js)
       └── Madden Penalty Catalog (shared/penaltyCatalog.js)
       │
[ OCR & Vision Subsystem (ocr/) ]
       ├── Gridiron Capture Bridge (capture-bridge/GridironCaptureBridge.exe)
       ├── Python OCR Sidecar Worker (ocr-sidecar/ - OpenCV / Tesseract)
       └── Shared Text & Grammar Parsers (ocr/shared/)
       │
[ Audio Engine (vendor/whisper/) ]
       └── On-device Whisper binary (local STT)
```

- **Data Persistence:** User preferences, team profiles, and persistent scouting history are saved locally in the standard Electron `userData` directory (`preferences.json`, `localStorage`).
- **Telemetry & Privacy:** Zero cloud telemetry. All playbooks, voice processing, and screen captures are processed strictly on your local hardware.

---

## Installation & Setup

### Prerequisites

- **OS:** Windows 10 or Windows 11 (64-bit)
- **Node.js:** Node 18.0.0 or higher
- **Hardware:** Dual-core CPU or better, 4GB RAM minimum (8GB recommended for concurrent OCR capture)

### Development Setup

Clone the repository and install dependencies:

```powershell
npm install
npm start
```

*Note: `npm start` automatically runs `npm run check:core` to validate all shared coordinator engines before launching Electron.*

### Building the Windows Installer

To generate a standalone Windows NSIS installer (`.exe`):

```powershell
# Run the automated build script
cd dist
.\rebuild-installer.cmd
```

Or run manually via npm:
```powershell
$env:ALLOW_GPL_FFMPEG="true"
npm run dist
```
The resulting installer is output to `dist\Gridiron Play Advisor Setup <version>.exe`.

---

## Testing & Quality Verification

Gridiron OC includes a comprehensive regression and domain validation suite. Always run verification before packaging:

```powershell
# Run all PC verification suites (Core check, OCR tests, regressions, defensive tests)
npm test
# or:
npm run verify:pc

# Run individual test components
npm run check:core             # Validate local PC shared modules
npm run test:regression        # App UI & play-calling regressions
npm run test:ocr:js            # OCR grammar, confusables, and parser checks
node scripts/smoke-defense-situation.mjs  # DC situation and blitz balance checks
```

---

## Security & Privacy Standards

Gridiron OC enforces strict local-only execution and repository hygiene practices:

- **100% Local Execution & Zero Telemetry:**
  - Speech-to-Text runs locally using bundled Whisper models.
  - OCR and computer vision run locally via on-device Tesseract and ONNX runtimes.
  - No prompt data, game telemetry, audio, or video streams are ever transmitted to external cloud servers.
- **Repository Hygiene & Secret Isolation:**
  - Sensitive configurations (`.env`, `.env.*`), credentials (`credentials.json`), certificates (`*.jks`, `*.keystore`, `*.p12`), and private Electron `userData/` are strictly excluded via `.gitignore`.
  - Python virtual environments (`ocr-sidecar/.venv/`, `.venv/`) and native build intermediate outputs are permanently ignored.
  - Internal development records and hardware logs (`session_handoff.md`, `*.log`) remain exclusively local.
- **Distribution Hygiene:**
  - Packaged installers (`dist/`, `*.exe`) are excluded from Git repository tracking and are distributed exclusively through official GitHub Releases assets.
- **Author Identity Privacy:**
  - All repository commits are authored and mapped to verified GitHub no-reply addresses (`GenNowGamer@users.noreply.github.com`).

---

## License & Trademarks

- **Proprietary Software:** All rights reserved.
- **Third-Party Notices:** Bundled open-source libraries and licenses are detailed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Disclaimer:** Gridiron OC is an independent companion tool and is not affiliated with, endorsed by, sponsored by, or approved by Electronic Arts Inc., EA SPORTS, the National Football League (NFL), or any NFL team. All product and company names are trademarks™ or registered® trademarks of their respective holders.
