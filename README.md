# Gridiron OC (PC)

[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2B%20%7C%20Electron-blue.svg)](#prerequisites)
[![Version](https://img.shields.io/badge/Version-0.1.19-green.svg)](#testing--quality-verification)
[![License](https://img.shields.io/badge/License-Proprietary-red.svg)](#license--trademarks)

**Gridiron OC** is a desktop smart play-calling companion for football video games (such as Madden NFL) and real-time football simulation. Designed for both Offense and Defense, it serves as an intelligent coordinator assistant that surfaces high-probability, context-aware play recommendations in real time.

Gridiron OC operates completely on-device with zero cloud dependencies, utilizing low-latency video capture and computer vision OCR to deliver seamless coordinator intelligence.

---

## Table of Contents

- [Core Purpose & Value Proposition](#core-purpose--value-proposition)
- [Key Features](#key-features)
  - [Offensive Coordinator (OC) Workspace](#1-offensive-coordinator-oc-workspace)
  - [Defensive Coordinator (DC) Workspace](#2-defensive-coordinator-dc-workspace)
  - [Play Sequencing & Tactical Tendency Radar](#3-play-sequencing--tactical-tendency-radar)
  - [Halftime Review & Strategic Adjustments](#4-halftime-review--strategic-adjustments)
  - [Computer Vision OCR Capture](#5-computer-vision-ocr-capture)
  - [Game Management, Scoreboard & Call Sheet](#6-game-management-scoreboard--call-sheet)
  - [Opponent Scouting & Tendencies](#7-opponent-scouting--tendencies)
  - [Post-Game Coordinator Report](#8-post-game-coordinator-report)
- [Operator's Field Manual (User Guide)](USER_GUIDE.html)
- [How to Use Gridiron OC](#how-to-use-gridiron-oc)
  - [OCR Screen Capture Workflow](#ocr-screen-capture-workflow)
- [System Architecture](#system-architecture)
- [Installation & Setup](#installation--setup)
- [Testing & Quality Verification](#testing--quality-verification)
- [Security & Privacy Standards](#security--privacy-standards)
- [License & Trademarks](#license--trademarks)

---

## Core Purpose & Value Proposition

In competitive football gaming, calling plays under a running play clock can lead to repetitive tendencies, panic calls, or playbook fatigue. **Gridiron OC solves this by acting as your virtual coordinator**:

1. **Eliminates Repetitive Play-Calling:** Multi-tiered anti-repeat algorithms, session show limits, and whole-playbook freshness sampling ensure you stay unpredictable while maintaining sound football concepts.
2. **Context-Aware Strategy:** Understands down, distance, yard line, score differential, clock urgency, and opponent habits.
3. **Dual-Sided Mastery:** Seamlessly switch between offensive playbook mastery and defensive package counters.
4. **Adaptive Personal Learning:** Learns which concepts succeed or fail against specific looks across your games.
5. **Zero Lag & Complete Privacy:** Runs 100% locally on your machine with on-device computer vision and offline OCR processing.

---

## Key Features

### 1. Offensive Coordinator (OC) Workspace

- **Top-3 Recommendation Slate:** Evaluates your entire 32-team NFL playbook catalog and presents the 3 best calls for the exact down, distance, and field spot.
- **Why-This-Call Chips:** Every recommendation tile displays live contextual rationales (e.g., *Identity Fit*, *Sets up Play-Action*, *Coverage Beater*, *Third-Down Converter*).
- **Playcalling Modes:** Instantly reshape your playbook strategy with specialized tactical overlays:
  - **Normal:** Balanced, situation-driven adaptive play calling dynamically tailored to your team's assigned tactical identity (e.g., Chicago Bears "PA Motion Explosive", Baltimore Ravens "Option & Power Run", Kansas City Chiefs "Downfield Spread Attack"). Calibrated to achieve 50%+ post-game Identity Fit execution without requiring secondary style toggles.
  - **2 Minute Drill:** Prioritizes sideline access, quick yardage, and hurry-up pass concepts.
  - **Kill Clock:** Favors interior runs, clock-chewing concepts, and conservative pass options.
  - **Comeback:** Aggressive chunk-play hunting with deep intermediate pass concepts.
  - **Blitz Beater:** Hot throws, screens, draws, and quick perimeter answers that neutralize blitzes.
  - **Redzone:** Short-field spacing concepts (smash, smash-corner, snag, mesh, duo, power, and RPO).
- **Opening 15 Script Builder ("Build A Script"):**
  - Assemble a custom 15-play opening script directly from your team's playbook before kickoff or during opening series.
  - **Authentic NFL Setup-to-Payoff Architecture:** 1-click **Auto-Fill 15** sequences the opening script using true NFL game-planning logic:
    - *Slots 1–4:* Establishing interior line of scrimmage (Inside Zone, Duo, Power) and rhythm passing (Quick Game) while stressing perimeter leverage.
    - *Slot 5 & 10 (Play-Action Payoffs):* Automatically pairs high-percentage PA deep shots directly off the primary run family and personnel groupings established in preceding series.
    - *Slots 6–15:* Methodical progression through misdirection constraints (Counter, Screen, Trap), intermediate chain movers (Mesh, Levels, Dig), perimeter stretching, deep explosive shots, money down answers, and red zone finishers.
  - **Two-Game Script Cooldown:** Excludes plays from your last 2 live executed game scripts from appearing in Auto-Fill 15 to ensure varied game-to-game scripts, while permitting unlimited re-generation preview clicks without penalizing the pool. Includes automatic soft fallback so all 32 NFL teams always generate full 15-play scripts.
  - **Live Snap Injection:** When the script is active, Slot #1 of your recommendation slate features the next scheduled scripted call (`Script #1` through `Script #15`), while Slots #2 and #3 provide situational counters.
  - **Smart Situational Yield:** On extreme passing downs (e.g. 3rd/4th & 10+), if the scheduled scripted play is a run or RPO, the Auto Playcaller automatically yields priority to Slot #2's situational pass call without burning the scripted play.
  - **Zero Cross-Game Persistence:** Scripts are game-specific and team-tailored—clearing cleanly upon New Game or team changes without lingering across sessions.
  - **Interactive Management:** Quick search, single-click +Add, re-ordering (▲/▼), deletion (✕), clear, and 1-click **Auto-Fill 15**.
- **Auto Playcaller Mode (Hands-Free Coordinator Execution):**
  - Optional toggle available in **Settings** and the pre-game **Matchup & Broadcast Setup** modal.
  - Evaluates the top-3 coordinator recommendations dynamically on both OC and DC sides, identifying the optimal call based on active sequence payoffs, opponent defensive/offensive tendencies, opening script priorities, and score/clock context.
  - **Intelligent Defensive Football Logic:** 
    - *Goal Line Override:* Automatically prioritizes heavy Goal Line packages inside the 3-yard line on goal-to-go spots.
    - *Money Down Passing Counters:* Rotates Dime, Dollar, and 3-3-5 coverage packages on 3rd & 7+ situations.
    - *Defensive Front & Shell Rotation:* If candidate #1 repeats the same front as the previous snap, dynamically rotates to a competitive alternate front (within 3.0 points) to avoid repetitive looks.
    - *3-3-5 Personnel Matching:* Enables 3-3-5 fronts to naturally counter 3-WR/spread formations alongside Nickel.
  - Instantly confirms the winning play, updating down/distance settlement, play cooldowns, and session metrics automatically upon OCR capture.
- **Setup-to-Payoff Engine:** Tracks conceptual sequencing across drives (e.g., establishing inside zone to unlock explosive play-action bootlegs later in the series).
- **Full-Playbook Exploration Engine:** 
  - **Slot 1 & Slot 2 Temperature Sampling:** Uses softmax exploration across near-tie optimal calls so high-variance primary calls and complementary counters rotate naturally.
  - **Slot 3 Fresh-Play Elasticity:** Periodically draws from unexposed plays across the entire playbook (`_sessionShowCount === 0`) using bounded softmax probability flooring (`Math.max((score - best) / temp, -4.5)`), guaranteeing that uncalled plays are never mathematically zeroed out and ensuring wide playbook exploration across full games.
  - **Red Zone & Goal-to-Go Pass Prioritization:** Explicitly classifies specialized red zone passing concepts (`redzone_pass`) with dedicated situation scoring bonuses (+7.5 in red zone geography), elevating calls like `Redzone Scissors` and `Redzone HB Scissors` to top recommendations inside the 20-yard line and in goal-to-go spots.
  - **Balanced Scheme Stacking & Play-Action Calibration:** Softens early-down schedule penalties on play-action (`gainFitScore` penalty factor softened to 0.45) and removes blanket pressure penalties on standard looks, allowing deep PA concepts, motion bootlegs, wheel concepts, and jet touch passes to surface naturally alongside interior ground schemes.


### 2. Defensive Coordinator (DC) Workspace

- **Comprehensive Defensive Catalog:** Includes all 32 NFL teams and over 8,200 unique defensive plays across 3-4, 4-3, Nickel, Dime, Dollar, and Goal Line fronts.
- **Realistic Blitz & Pressure Balancing:** Delivers authentic NFL pressure rates (~25%–35%) with fine-grained classification between disguised `zone_blitz` and aggressive `man_blitz`.
- **Sticky "Offense Showing" Biasing:** Quickly tap the opponent's offensive formation (e.g., *Gun Bunch*, *Singleback Wing*, *I-Form*) to bias defensive recommendations toward optimal personnel groupings.
- **Strict Situation Gating:**
  - *Goal Line Fronts:* Enforced strictly on goal-to-go inside 3 yards or critical short-yardage downs.
  - *Prevent Packages:* Restricted to Hail Mary situations or protect-the-lead late-game scenarios.
- **Standard Exact Calls:** Receive exact defensive play calls matched directly to your selected team's loaded defensive playbook.
- **Dynamic Play Rotation & Session Exposure:**
  - **Session Play Exposure Memory:** Retains game-long tracking of surfaced defensive calls across series, penalizing repetitive calls and ensuring balanced playbook rotation.
  - **Play Rotation & Surface Depth:** Candidate plays are dynamically scored and sorted by fewest session appearances, rotating through the entire playbook rather than anchoring to repetitive calls.
  - **Selection Engine Diversity Alignment:** Exact Calls leverage the shared composite selection engine (`selectDiversitySlate`) with temperature exploration and multi-batch repetition bans while strictly preserving situational sound rules.

### 3. Play Sequencing & Tactical Tendency Radar

- **Play Sequencing Progression (`⚡ SEQUENCE PAYOFF`):** Detects established ground sequences ($\ge 2$ consecutive run or RPO calls) and highlights corresponding play-action, leak, boot, flood, shot, or vertical payoff passes with an eye-catching purple/indigo badge and dedicated setup context notes.
- **Opponent Habits (Live Tendency Radar Banner):** Positioned immediately above the recommendation cards in both OC and DC workspaces. Analyzes live game scouting history to dynamically broadcast:
  - *Observed Opponent Tendency:* (e.g., *"Shows Cover 3 on 2nd & 7"* or *"High Blitz Tendency on 3rd Down"*).
  - *Recommended Tactical Hard Counter:* Surfaces proven conceptual counters (e.g., *"Hard Counter: Flood / Seams / PA Boot"* or *"Counter: Quick Slants / Bubble Screen"*).

### 4. Halftime Review & Strategic Adjustments

- **Strategic 1st-Half Debrief Panel:** Embedded directly inside the Halftime Adjustment overlay, delivering an instant tactical breakdown before entering Quarter 3:
  - **1st Half Run/Pass Split:** Displays the exact ratio and percentage split of ground vs. aerial play calls.
  - **Top Offensive Concept:** Identifies the highest-yield concept executed in the first half.
  - **Primary Opponent Defense Faced:** Pinpoints the opponent's most heavily utilized coverage shell.
  - **Coaching Takeaways & Adjustments:** Offers coordinator recommendations on whether to balance the attack, exploit coverage weaknesses, or maintain pressure.

### 5. Computer Vision OCR Capture
 
 - **Local Computer Vision (Madden OCR DC & OC):**
   - Connects to your gameplay via the bundled **Gridiron Capture Bridge** (compatible with PC window capture or Elgato capture cards).
   - Automatically reads the on-screen scoreboard (down, distance, yard line, and upcoming offensive formation) without sending video data to external servers.
   - Calibrates to major broadcast presentation styles (Default, TNF, MNF, SNF).
   - **Deterministic Normalization & Repair Engine:** Automatically repairs clipped personnel fragments (`RITER`, `RTER`, `RBITEIR`, `RBITEISR`, `RITEISR`, `RIYELWR`, `IRBIOTELWR`), corrupted HUD chrome (`CYAALB`, `CYAAALB`), and glued/damaged Madden play names (`SILVERSHOOTNCH`, `SAMMKELOOP`, `DTMKELOOPA`, `LBBLITZO`, `COVERIMBBLITZ`, `LDUBLEWRI`, `ZZZIN`, `MTNYCORNERUNER`, `NCKELSIMZ`, `NCKELZTRAP`, `ESCAPE`, `FKTOSSSLIDE`, `DEEPSTICK`, `MTNDRIVE`, `FOURVERTICALS`), preventing manual correction overhead during live sessions.
   - **Structural Broadcast Personnel Recognition:** Utilizes generalized structural sequence and archetype matching across all presentation styles (Default, TNF, MNF, SNF). Fused broadcast pipes and ornament artifacts (such as TNF badge compressions `RYTITEIWR`, `ITEIR`, `RITEIR`, `ITER`, `1TE3WR`, `RBITEIR`, `IRBITEIWR`) are automatically resolved to legal NFL personnel packages (`1RB - 1TE 3WR`) without requiring manual review.
   - **Manual Review for formation / personnel:** If the strip says review is required for `offense_formation_personnel`, open **Review**, correct the field, and choose **Accept Corrections**. Unaccepted raw OCR noise is never pre-filled into the review input. Skill counts must add to 5 (`RB + TE + WR`). Empty backfield is valid (`0RB - 1TE 4WR`, `0RB - 2TE 3WR`). A typed `0RB` is kept in that case. `0RB` paired with TE + WR totaling 4 (for example `0RB 1TE 3WR`) is still treated as a misread `1RB`. The review row states this when the field is still rejected.
   - **Auto Playcaller Option:** When enabled, automatically generates and surfaces coordinator play calls upon each successful OCR snap detection.

### 6. Game Management, Scoreboard & Call Sheet

- **Call Sheet Layout:** OC and DC share one fixed layout. Game context (scoreboard, situation, playcalling mode or offense showing) sits in a left rail. The play calls fill the rest of the window. There is no screen-layout picker and no draggable window positions.
- **Interactive Game Scoreboard & Automatic Scoring:**
  - Track and adjust score (*You / Opp*) and quarter (*Q1–Q4, OT*) directly on both the OC and DC call sheets with zero desync.
  - Automatically factors score differential and remaining time into coordinator play-calling aggression and defensive shell eligibility.
  - **Drive Result & Game State Scoring Integration:** Selecting scoring outcomes in OC or DC Game State automatically updates the scoreboard:
    - *Touchdown (OC / DC):* Automatically awards 6 points and triggers a streamlined, transparent modal overlay prompting for extra point attempts (+1 PAT, +2 Two-Point Conversion, or 0 Missed/None).
    - *Field Goal:* Automatically awards 3 points to the scoring side.
    - *Safety:* Automatically awards 2 points to the defending side.
    - *Pick 6 / Scoop & Score:* Automatically awards 6 points to the recovering side with the same transparent PAT overlay.
- **Halftime Adjustments & Debrief:**
  - Unlock mid-game coordinator style adjustments alongside the 1st-half debrief panel without erasing accumulated opponent scouting or game drive history.
- **Audible Overlay:**
  - If you audible at the line of scrimmage, swap your confirmed play to the actual play executed from the same formation/set so your learning model stays accurate.
- **Penalty Tracking:**
  - Stamp Madden flags (*holding, pass interference, false start*) to ensure penalized snaps do not corrupt your playbook success metrics.
- **Drive Result Tracking & Coordinator Handoff:**
  - Log possession outcomes (*Touchdown, Field Goal, Punt, Turnover, Sack*) to reinforce situational learning and automatically hand off between OC and DC workspaces.

### 7. Opponent Scouting & Tendencies

- **Last Defense Shown Bar (DC side):**
  - With a single tap, record the coverage shell the defense ran (*Blitz, Man, C1, C2, C3, C4, C6, C9, Tampa 2*).
  - Builds a multi-game tendency database against human opponents or CPU profiles.
- **Predictive Pre-Snap Layering & Tendency Radar:**
  - When the defensive look is unknown, Gridiron OC predicts the opponent's likely coverage based on historical tendencies in that down/distance and biases offensive calls accordingly, while displaying live tactical counters on the Opponent Tendency Radar banner.

### 8. Post-Game Coordinator Report

At the conclusion of each match, select **End Game** to view a comprehensive analytical debrief:
- **Trust & Fidelity Scores:** Evaluates how consistently you executed the coordinator's recommendations.
- **Success Leaders:** Pinpoints your most effective plays and concepts (requiring minimum sample sizes).
- **Scouting Matchup Breakdown:** Details how often your offensive calls exploited the opponent's defensive tendencies.
- **Learned Adjustments:** Summarizes strategic tweaks stored for future matchups against this opponent.

---

## How to Use Gridiron OC

### OCR Screen Capture Workflow

1. On launch, select your broadcast presentation style right from the **Matchup & Broadcast Setup** modal (`Default`, `TNF`, `SNF`, `MNF`), or open **Calibrate capture** in Settings.
2. In **Settings**, select your capture card or Madden PC window.
3. Align the ROI crop boxes with your broadcast scoreboard and test the profile.
4. Enable **OCR Capture** in Settings.
5. In game, press the capture hotkey (`F8` or `Ctrl+Shift+D` by default). Gridiron OC will parse the live situation and surface play calls instantly with the optimal play auto-selected (you can freely override or select any of the top-3 calls at any time).
6. If the OCR strip says **Review required**, open **Review**, fix the listed field, and choose **Accept Corrections**. For upcoming formation / personnel, enter a formation name or a five-skill grouping such as `1RB - 1TE 3WR` or `0RB - 1TE 4WR`.
7. **100% Lifecycle Parity:** Every OCR capture automatically resolves prior snap outcomes (`settlePendingOcSnap`), logs previous defense coverages into opponent scouting (`logOcrPreviousDefense`), advances play-calling cooldowns, and updates personalized learning.

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
```

- **Data Persistence:** User preferences, team profiles, and persistent scouting history are saved locally in the standard Electron `userData` directory (`preferences.json`, `localStorage`).
- **Telemetry & Privacy:** Zero cloud telemetry. All playbooks and screen captures are processed strictly on your local hardware.

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
  - OCR and computer vision run locally via on-device Tesseract and ONNX runtimes.
  - Recommendation cores and coordinator logic execute entirely on-device with zero external network calls.
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
