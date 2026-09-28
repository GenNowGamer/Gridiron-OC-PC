# Gridiron OC (PC) â€” Changelog & Evolution

This document tracks release milestones, historical architecture shifts, and incremental feature updates for the **Gridiron OC (PC)** desktop application. For current user-facing product features, architecture overview, and setup instructions, see [README.md](README.md).

---

## Current Active Release: v0.1.7 (2026-09-26)

### Highlights & Recent Changes

- **DC Blitz Recommendations & Concept Splitting (v0.1.7):**
  - Rebalanced the defensive play-calling pipeline so blitz packages surface at realistic football frequencies (~25%â€“35% across games).
  - Categorized pressures into `zone_blitz` and `man_blitz`, safely rewarding disguised zone pressures on early downs and 3rd & medium/long without over-promoting raw zero blitzes.
  - Relaxed DC package diversity bans (`shownFamilyBanBatches: 0`) to prevent global blitz lockouts after a single exposure.
  - Implemented complementary coverage/pressure counter-pairing in the DC selection engine.
  - Verified via `node scripts/smoke-defense-situation.mjs` and `npm run verify:pc`.

- **PC Core Autonomy & Independent Build System (v0.1.6):**
  - `PC/shared/` is now fully authoritative for the PC desktop build (`npm run check:core`).
  - Decoupled from legacy mobile synchronization scripts; PC builds directly validate local modules.
  - Hardened OC ranking to retain capped football-fit, identity, learning, historical variety, novelty, and mode/scoreboard contributions.
  - Ensured whole-game OC appearance counters survive rolling recent-history windows, and exact Call sheet IDs remain remembered until New Game.

- **Defensive Situations & Goal-Line Logic (v0.1.6):**
  - Defensive goal-line packages are restricted strictly to true goal-line situations (goal-to-go inside 3 yards or opponent 1â€“3 on short/late downs).
  - Open-field 1st & 10, 2nd & 10, 3rd/4th & 1, and long goal-to-go do not surface Goal Line defenses.
  - Prevent defense eligibility restricted to Hail Mary looks or protect-the-lead late-game situations (Q4/OT, or late Q2 with 15+ yards to go).

- **Madden OCR DC Capture Bridge & Pipeline Hardening:**
  - Migrated exclusively to **Gridiron Capture Bridge** (`GridironCaptureBridge.exe`) for low-latency Windows Desktop or Capture Card (e.g., Elgato 4K60 Pro) frame ingest.
  - Fully removed legacy OBS plugins and OBS WebSocket configurations.
  - Added multiline HUD OCR parsing with confusable glyph repairs (e.g., `BOAL`/`G0AL` â†’ Goal, `COVERA` â†’ 4, `451` pipe-bleed suppression).
  - OCR Opponent Scouting: Offensive OCR spots automatically log accepted previous defensive plays into the Last Defense Shown writer before down transitions.
  - Exact Call variety caps each play at two appearances per game; cleans on New Game.
  - Automatic mid-drive confirm scoring during offensive OCR spot progression.

- **Audio & Speech Architecture Update:**
  - Speech-to-Text (STT) uses bundled, on-device **local Whisper** for hands-free down/distance/spot capture.
  - Spoken play readout (Kokoro TTS) was removed from the desktop app (2026-09-18) to streamline runtime footprint and package stability. Desktop play recommendations are presented visually.
  - External cloud AI endpoints (`/api/ai/*`) removed; all play calling runs 100% locally via deterministic and adaptive rule/MMR engines.

---

## Release History

### v0.1.6 (2026-09-25)
- **OCR Parser Repairs:** Live session parser repairs for broadcast layouts (Default, TNF, MNF, SNF).
- **Defensive Penalty-to-Learning Fixes:** Connected DC penalty picker directly to learning gates to prevent false negative learning on penalized snaps.
- **Exact Attribution:** DC formation/set attribution on user agreement; impossible personnel combinations withheld from recognition.
- **Local Installer Automation:** `dist/rebuild-installer.cmd` auto-increments patch versions and handles locked `%TEMP%` build fallbacks.

### v0.1.5 (2026-09-24)
- **Goal-Line Gate:** Enforced true goal-line contexts for defensive goal-line calls.
- **OCR Exact Call Variety:** Whole-game exact call memory with 2-appearance caps.
- **HUD Digit Repairs:** Long-yardage down/distance repair (`1S1 & 20` â†’ 1st & 20).
- **End Game Mode Reset:** Triggering End Game automatically restores the play-calling mode to `Normal` and writes to user preferences.
- **Usage Recorder Script:** Added `PC/scripts/measure-gridiron-usage.ps1` for recording live CPU/memory footprints across app, sidecar, Whisper, and capture bridge.

### v0.1.4 (2026-09-23)
- **Opponent Scouting Pipeline:** Automated logging of accepted defensive coverages on offensive OCR spot transitions.
- **Confirm Scoring:** Automatic evaluation of pending confirmations across drive progressions.
- **Default Font HUD Support:** Added contour and glyph confusion dictionaries for standard broadcast scoreboards.

### v0.1.3 (2026-09-22)
- **Selection Engine Integration:** Activated Stage-2 `selectionEngine.js` with batch-based shown bans, session play hard cap of 2, repeat taxes, and diversity slate building.
- **Madden Playbook Catalog Corrections:** Corrected play definitions (Jet Pull Shallow to Pass, proper RPO categorizations).
- **Capture Bridge Default:** Switched capture pipeline to Capture Bridge V1; resolved 4K60 Pro Media Foundation initialization crashes.

### v0.1.2 (2026-09-18)
- **TTS Retirement:** Fully removed Kokoro TTS dependencies and voice-picker playback options; switched to silent visual recommendation tiles.
- **Prevent Context Rules:** Hardened DC Prevent package criteria to prevent inappropriate 3rd-and-medium calls.
- **OCR Exact Calls Hardening:** Multi-frame temporal consensus and bare yard 50 midfield handling.

### v0.1.1 (2026-09-16)
- **DC v2 Package Board:** Instant package recommendations based on situation and sticky Offense Showing chips.
- **Cloud AI Decommission:** Stripped remote API endpoints; finalized pure on-device execution.
- **Settings UI Polish:** Added vertical scrolling to desktop preferences card for lower-resolution monitors.

### v0.1.0 & Earlier Desktop Milestones
- **Desktop Branding:** Transitioned identity to `Gridiron OC` with custom taskbar AUMID, executable PE icons, and desktop shortcuts.
- **Dual OC / DC Workspace:** Introduced topbar role switch between Offensive Coordinator and Defensive Coordinator boards.
- **Game Scoreboard Integration:** Live You/Opp score and Quarter/OT stepper with late-game urgency bias.
- **Audible & Penalty Overlays:** Post-confirm play substitution and Madden flag tracking with selective learning exclusions.
- **Opponent Scouting & Tendencies:** Saved profiles and adaptive pre-snap coverage bias.
- **Coordinator Report:** End-game post-match analytics grading play-calling fidelity, scouting success, and script discipline.
