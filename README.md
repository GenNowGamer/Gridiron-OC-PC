# Gridiron OC PC

## PC-only maintenance update — 2026-09-25

This checkout now builds independently. `PC/shared` is authoritative for this PC
app. Start and installer builds validate those local modules with `check:core`;
they do not read or copy Mobile files. The old sync script is disabled. Older
Mobile parity/sync instructions below describe the previous workflow.

- OC ranking retains the capped football-fit, identity, learning, historical
  variety, novelty, and mode/scoreboard contributions. The selection engine uses
  that score, applies recent-repeat penalties, and chooses the diverse slate;
  it does not reweight uncapped parts or apply outcome learning a second time.
- Whole-game OC appearance counters survive the rolling recent-history window.
  Exact Call sheet IDs likewise remain remembered until a new game.
- Terminal results follow the same penalty learning gates as spoken outcomes.
- OCR duplicate spots do not manufacture snaps. Attribution advances even with
  learning disabled, and resets at drive/game/team/opponent/role boundaries.
  In-flight captures from an earlier boundary are rejected.
- `npm run verify:pc` runs production-renderer regressions, OCR JS tests/domain
  checks, and defensive-situation checks. `npm run dist` requires these checks
  and rebuilds both native helpers, including the locked-output fallback used by
  `dist/rebuild-installer.ps1`.

Electron desktop build of the Gridiron OC play-calling app.

Last updated: 2026-09-25 (v0.1.6)

## Command Execution Protocol (Persistent Project Rule)

For all future sessions on this project, any time the assistant asks the user to run terminal commands, instructions must always include:

- terminal type: `PowerShell` or `Command Prompt (cmd)`
- privilege requirement: `Administrator` or `non-Administrator`
- exact run location with explicit `cd` step when needed
- copy/paste-ready fenced command blocks

Required format:

1. `Terminal:` shell + admin status
2. `Run from:` full path
3. `Command(s):` one or more easy-copy code blocks

Copy/paste requirement:

- Command blocks must be ready to paste as-is (no placeholders unless explicitly marked like `<TARGET_PATH>`).
- Prefer a single command window per step so the user can click Copy once and run immediately.

If the user begins in `cmd` and needs Administrator PowerShell in a specific folder, provide this copy-ready bootstrap command with the path filled in:

```cmd
powershell -Command "Start-Process PowerShell -Verb RunAs -ArgumentList '-NoExit','-Command','cd ''<TARGET_PATH>'''"
```

## Tooling Recommendation Preference

If a tool such as Docker, a Python virtual environment, or another extension/tool can improve reliability, setup, testing, or build speed for PC or Mobile work, proactively recommend it for that specific situation.
Do not assume the current setup is best if there is a safer or faster option.

## Extension Collaboration Protocol

For all future PC or Mobile tasks, the assistant should evaluate whether an installed VS Code extension (or a relevant extension from the VS Code Marketplace) can materially improve speed, reliability, debugging, or safety for the requested work.

If an extension can help:

- Recommend it before implementation starts.
- State the expected benefit for the current task.
- Clearly state whether user action is required in VS Code.
- Provide the exact command/action to run when needed, then continue once output is provided.

Constraint reminder:

- The assistant cannot directly click or run VS Code extension UI actions from chat tools.
- Use CLI/tooling equivalents automatically when they provide the same benefit.
## Recommendation Core Parity Update (2026-03-31)

- Desktop now consumes a synced copy of the shared recommendation core.
- Source of truth:
  - `Mobile/shared/recommendationCore.js`
  - `Mobile/shared/selectionEngine.js` (OC Stage-2 slate builder; anti-repeat 2026-09-22; keep Mobile↔PC synced)
  - `Mobile/shared/defenseRecommendationCore.js` (DC top-3 + Offense Showing soft-bias; synced as of 2026-09-15)
  - `Mobile/shared/coordinatorReport.js` (End Game report; synced as of 2026-09-11)
  - `Mobile/shared/penaltyCatalog.js` (Penalty picker learning gates; synced as of 2026-09-11)
- Desktop synced copies:
  - `PC/shared/recommendationCore.js`
  - `PC/shared/selectionEngine.js`
  - `PC/shared/defenseRecommendationCore.js`
  - `PC/shared/coordinatorReport.js`
  - `PC/shared/penaltyCatalog.js`
- **Sync**: `PC/shared/` is authoritative for this PC project. `npm run check:core`
  validates all five shared modules locally. The old Mobile↔PC sync automation
  is retired; the sync script now prints a message and exits cleanly.

## Overview

This desktop build is no longer just a shell around the older prototype.

Current direction:

- desktop branding now matches `Gridiron OC`
- the packaged Windows build uses the custom Gridiron OC icon (embedded in the `.exe` PE resources, plus `icon.ico` outside the asar for shortcuts/window)
- the desktop app now shares the same recommendation core paths with mobile for parity-critical logic

## Current Status (Last code/doc verification: 2026-09-25, v0.1.6)

- **Installer 0.1.5 / 0.1.6 (2026-09-25):** Full PC verification passing (`npm run verify:pc` includes 28 OCR main tests, 51 OCR domain checks, 28 regression tests, and 8 defensive situation checks). Includes CHI–PHI live session parser repairs, defensive penalty-to-learning disconnect fixes, exact DC formation/set attribution on agreement, resolution of corrected plays to catalog IDs, impossible personnel total withholding, and whole-game Exact Call memory.
- **Local installer build automation:** `PC\dist\rebuild-installer.cmd` bumps the patch in `package.json` before each build and restores it if the build fails. If `dist\win-unpacked` is open in the editor, the script packages in `%TEMP%\gridiron-play-advisor-pack` and copies `dist\Gridiron Play Advisor Setup <version>.exe` back.
- **DC blitz recommendations & concept splitting (2026-09-25):** Rebalanced defensive recommendation pipeline so blitz plays surface at realistic NFL frequencies (~25%–35% across games). Classifies pressures into `zone_blitz` and `man_blitz` (safely rewarding disguised zone pressures on early downs and 3rd & medium/long without promoting raw zero blitzes), relaxes DC package diversity bans (`shownFamilyBanBatches: 0`) to prevent global blitz freezes after a single exposure, and adds complementary coverage/pressure counter-pairing in the selection engine. Verify: `node scripts/smoke-defense-situation.mjs` and `npm run verify:pc`.
- **DC goal line (2026-09-24):** Goal-line defenses are used only on a true goal-line spot (goal-to-go within a few yards, or the opponent’s 1–3 on a short or late down). Open-field 1st & 10, 2nd & 10, 3rd/4th & 1, and long goal-to-go do not surface them. Shared with Mobile via `defenseRecommendationCore.js`. Verify: `node scripts/smoke-defense-situation.mjs`.
- **OCR Exact Call variety (2026-09-24):** Shown Exact Call plays stay remembered for the whole game and are capped at two sheet appearances. Against 3+ WR, two of the three calls stay in the nickel personnel band. New Game clears that memory; a drive reset does not.
- **Default-font HUD (2026-09-24):** The shared parser repairs outlined down/field/play text (`TST`/`ATH`, `A'3'A` → OPP 34, `SLOTBITZS`, `COVERGWLLE`, and the other cases in `smoke-ocr-domain.mjs`). Presentation styles share these rules. Saved crop boxes stay on this PC only. Verify: `node scripts/smoke-ocr-domain.mjs`.
- **OBS capture removed (2026-09-24):** Calibrate no longer offers an OBS plugin or OBS WebSocket. Capture Bridge is the only ingest. A profile saved with an old OBS adapter loads as Capture Bridge. Verify: `node --test ocr/main/test/ocr-main.test.js` and, from `ocr-sidecar`, `.\.venv\Scripts\python.exe -m unittest discover -s tests`.
- **OCR Opponent Scouting (2026-09-23):** On offense, a new OCR spot logs the accepted previous defensive play through the same Last Defense Shown writer before the down changes. Names map onto the button labels (Cover 3 Sky → Cover 3, Cover 6 Press → Cover 6, Tampa 2 unchanged). The log is what End Game → Opponent Scouting reads. The highlight is cleared before the new sheet, same as the next Tap & Speak. Same-spot recapture does not double-log. Unmapped names are skipped. Defense-role OCR does not log that crop (it is your own call). Requires a confirmed play still sitting on the spot being left.
- **OCR confirm scoring (2026-09-23):** When an OC OCR capture moves the spot, the pending confirm is scored before the next confirm can replace it, so a full OCR game keeps mid-drive confirms in the Coordinator Report. Same-spot recapture does not score. DC OCR does not settle the OC snap.
- **Long-yardage down/distance (2026-09-23):** `'1'S'1''&''2''0'` repairs to 1st & 20. Five-digit `'2''0''8''1''7'` repairs to 2nd & 17 (yards 10–40 only). `2010` and `'3'RD'&'百` stay rejected. Verify: the HUD test inside `node PC/scripts/smoke-ocr-domain.mjs`.
- **End Game resets playcalling mode (2026-09-23):** Game State → **End Game** builds the Coordinator Report from the mode used in that session, then sets playcalling mode back to **Normal** and writes that into preferences. The report overlay already shows Normal underneath. If the mode was already Normal, preferences are left unchanged. Mobile is unchanged. Verify: `node --check PC/app.js`, then End Game from 2 Minute Drill (or any non-Normal mode) and confirm the mode strip and the next launch are Normal.
- **Usage recorder (2026-09-23):** `PC/scripts/measure-gridiron-usage.ps1` samples Gridiron OC CPU and memory about once a second (app, OCR sidecar, capture bridge, Whisper, FFmpeg) plus a one-time machine snapshot. Markers are `1` idle, `2` speak, `3` ocr, `q` stop. Logs go to `%TEMP%\GridironUsage\<timestamp>\`. Copy that folder back to compare machines. No install; Windows PowerShell 5.1.
- **Capture Bridge only (2026-09-24):** OCR frame ingest is bundled `GridironCaptureBridge.exe` (capture card or PC window). The OBS plugin and OBS WebSocket settings are removed. Calibrate → Refresh sources → Capture Reference. Build: `npm run build:capture-bridge`. Guide: `OCR_DC_GUIDE.md`. Elgato **4K60 Pro** needs the STA/MF Bridge build (crash `3221226505` was Bridge, not Sidecar). Unpackaged Electron uses `ocr-sidecar/.venv` for OCR (OpenCV); rebuild sidecar onedir when shipping (`build-sidecar.ps1`).
- **OCR HUD parse (live exports 2026-09-22):** Goal OCR (`BOAL`/`G0AL`/`60AL`), Cover digit confusables (`COVERA`→4, `COVERI`→1), ¥ field arrow, `451` pipe-bleed, personnel `IRBITE…`, glued plays (`HBSLIPSCREEN`, `COVBUZZ…`, `NSDEZONESPLIT`, …). Verify: `node PC/scripts/smoke-ocr-domain.mjs`. Score/quarter are **not** OCR — Game Scoreboard UI only.
- **Kokoro TTS removed (2026-09-18):** PC no longer ships spoken play readout. Preferences Voice Engine / Speak Top / voice picker and `vendor/kokoro` are gone. **Whisper** remains the desktop STT path. Rebuild installer before treating packaged builds as current.
- **DC Prevent eligibility (2026-09-18):** `isPreventEligibleContext` in `shared/defenseRecommendationCore.js` — Prevent only for Hail Mary offense showing, or protect-the-lead + long yardage (Q4/OT, or Q2 & ≥15). Not a generic 3rd-down call (e.g. midfield 3rd & 5). Verify: `node PC/scripts/smoke-defense-situation.mjs` when present.
- **DC v2 package board (2026-09-16, ON by default):** `ENABLE_DC_V2_PACKAGES=true` — situation chips + coarse offense tags refresh **package · coverage** leans instantly (`shared/defenseRecommendationCore.js`). Speak is optional. Rollback: set flag `false` on Mobile + PC. Smoke: `node scripts/smoke-dc-packages.mjs`.
- **OC recommendation exploration (2026-09-15, ON by default):** `ENABLE_RECOMMENDATION_EXPLORATION=true` in `PC/app.js` (and Mobile) activates shared-core **sampleRank1** + **situation MMR** so rank-1 rotates among near-tie “good football” calls instead of always argmaxing the same play/shell. Historical variety is undampened while exploration is on; script soft boosts use +3.5/+2/+1; monopoly families include boot/quick_game. Set the flag `false` on **both** platforms to roll back. Verify: `node scripts/smoke-defense-situation.mjs`.
- **OC selection engine (2026-09-18; anti-repeat 2026-09-22, ON by default):** `ENABLE_SELECTION_ENGINE=true` uses `PC/shared/selectionEngine.js` (synced ↔ Mobile) for the final top-3: diversity buckets, hard shown bans counted in **batches**, **session hard cap = 2** any-slot appearances per playId per game, repeat tax, wildcard prefers never-shown. Replaces `pickTopRecommendationsCore` when on. Kill-switch: set `false` on Mobile + PC. Verify: `node scripts/smoke-defense-situation.mjs`.
- **DC board (2026-09-14; catalogs + live UX 2026-09-15):** Topbar **OC | DC** opens a separate defense workspace. Tap & Speak ranks top-3 defensive calls from `defensive_plays.json` via `shared/defenseRecommendationCore.js` (**all 32 NFL teams / 8,214 plays**). DC speak skips OC learning. **Confirm / Audible / Penalty** work on the DC sheet without training OC. Sticky **Offense Showing** (formation→set) soft-biases the next speak. Status shows **Heard / Situation**. **Role switch does not regenerate** either board’s sheet. OC possession-ending Game State auto-switches to DC (except Quarter Expired / Just Reset / End Game / **Sack**). OC **Sack** stays on Offense and keeps the pending play so the next spoken situation can infer yards lost; OC **Safety** ends the drive and switches to DC. DC **Game State** (Sack, Punt, INT, Fumble Recovery, TD, Safety, Turnover on Downs) auto-switches to OC except Sack. Re-import: `node ../scripts/import-defensive-playbook.mjs --input ../imports/<Team>_defensive_playbook.xlsx --replace-team <CODE>`.
- **Powered By AI removed (2026-09-16):** Netlify `/api/ai/*` and PC AI settings/coach/IPC are gone. Play-calling uses **Classic ranking** only; **Whisper** STT remains on-device. Production Website redeployed; Netlify AI env vars deleted; OpenAI key revoked.
- **Settings scroll:** Desktop Preferences card scrolls inside the window (`max-height` + overflow) so controls are not clipped on short displays.
- **Traces / penalty (2026-09-14):** penalty stamps survive re-confirm / audible so the next speak still skips learning (PC + Mobile).
- App boots correctly
- Game State panel accessible without requiring a confirmed play
- Taskbar AUMID set to `com.gridiron.playadvisor.pc`
- Icon placed outside asar via `extraFiles`; window icon references `process.resourcesPath` when packaged
- Play-family classifier (`familyOf` in `app.js`, mirrored on Mobile) tags **all** playbook plays into named families (draw/iso/read_option/smash/verticals/levels_dig/curl_flat/snag_spot and prior cores). Catalog residual `pass_other`/`run_other` = **0** as of 2026-09-02; Madden display names unchanged
- **Boot fix (2026-09-02):** restored `const cleanText` + mode `*_SCRIPT_DECK` constants accidentally removed during family-deck patching — without them Playbook/Opponent/Identity stayed on `Loading...`. Prefer current `PC/app.js` over commit `c2b5834` alone until the fix is committed
- Windows `.exe` PE icon is embedded via `signAndEditExecutable: true` plus an `afterPack` rcedit hook (`scripts/after-pack-win-icon.mjs`)
- NSIS `customInstall` recreates Desktop/Start Menu shortcuts pointed at `icon.ico`
- Desktop / taskbar / shortcut icons confirmed correct after reinstall (2026-08-28)
- Goal-to-go spoken spots parse like Mobile (`1st and goal on the opponents 5` → spot 5, not forced to 1)
- Game Scoreboard (You/Opp + Q1–Q4 + **OT**) still **scores** late-game lean on the **next** Tap & Speak or playcalling-mode change; OT uses the same late-game bias intensity as Q4; resets on New Game / End Game; not stored in preferences
- **Halftime** stays visible on the Game Scoreboard (disabled until **New Game**); after a game starts it opens the coordinator style picker mid-game (does **not** reset scouting/learning/confirms), applies the chosen second-half lean, and auto-sets the scoreboard to **Q3**; End Game report grades each style segment and shows `Style A -> Style B` in the header
- After confirming a top-3 play, **Audible** opens a same formation/set picker so you can log the play you actually snapped; outcomes/variety/report follow the audible without reshuffling the frozen sheet
- After confirm, **Penalty** on the same bar opens a Madden-flag picker; voids undo variety and skip learning, other flags attach a neutral report outcome and block inferred package scoring (`PC/shared/penaltyCatalog.js`, synced from Mobile)
- **Boot/runtime fix (2026-09-10):** `computeRecommendations` learning path passed `traits:t` without defining `t` (STATUS showed `t is not defined` on first speak); now uses the local `traits` binding
- The **shown** top-3 sheet is frozen until Tap & Speak or a playcalling-mode change. Quarter, score, Last Defense Shown, and opponent edits update labels/logging only — they do **not** reshuffle plays
- Scoreboard taps still debounce **450ms** for status/UI coalesce; scoreboard **trace** logs one `scoreboard-change` entry **2s** after the last tap with the final score (no TTS / recommendation-exposure on score taps)
- Spoken parse hardened for Whisper mishits (`intent`/`antenna`, `and go`, `Nth down at Y`, `on my N` / `on the point`, `at the 50`, `26th` ordinals, leading-digit guess like `39 on my own 26`)
- **Opponent scouting:** Settings opponent select (persisted); per-opponent multi-game history + current-game log; predictive pre-snap bias when defense is Unknown; Last Defense Shown logs coverage for scouting history (does not carry reactive bias into the next top-3 regen)
- **Last Defense Shown** strip logs coverage after the snap (scouting + tendency history); it does **not** reshuffle the current frozen sheet and is **cleared** on the next Tap & Speak, playcalling-mode change, or OC OCR situation sync so predictive scouting runs again; also clears on New Drive / New Game / manual Clear; button order is **Blitz, Man, C1, C2, C3, C4, C6, C9, Tampa 2**; same-snap corrections replace prior observation. Offense OCR writes that same log from the captured previous defense when the spot changes.
- Recommendation trace includes scouting observation count and per-play `predict` / `reactive` / `personal` score breakdown
- Score floor prevents all-negative recommendation pools when variety penalties stack (e.g. red zone)
- **Coordinator Report** on End Game (trust, identity fidelity, success leaders with 2+ samples, cumulative script hits, scouting diet with matched vs logged matchup counts, variety, learned-for-next-game, New Session; penalty snaps excluded from Success/Learned)
- In-game adaptation: outcome memory after bad plays, mode-aware learning keys, variety dampening, late-game planner aggression when trailing/Comeback, turnover-risk penalties on deep concepts when backed up
- Smoke checks (PC): `node scripts/smoke-ocr-domain.mjs`, `node scripts/smoke-defense-situation.mjs`, `node scripts/smoke-defense-tendency.mjs`, `node scripts/smoke-opponent-scouting.mjs`, `node --test ./scripts/test-app-regressions.cjs`
- voice-first usage is still the main path (Tap & Speak → Whisper STT → recommendations)
- local Whisper is the desktop speech-recognition path
- Kokoro TTS was removed from the PC app (2026-09-18); spoken play readout is no longer packaged
- all 3 recommendations are shown at once in the main recommendation card
- the live advisor now includes mutually exclusive playcalling modes: `Normal`, `2 Minute Drill`, `Kill Clock`, `Comeback`, `Blitz Beater`, and `Redzone`
- the desktop build now carries forward drive-local sequencing, anti-repeat pressure, and soft personal learning behavior between launches
- desktop preferences now persist through an Electron `userData` preferences file, and the team/theme settings have been confirmed surviving full close/reopen
- the shared playbook data has been corrected so `CHI / Gun / Bunch Spread / JET PULL SHALLOW` is treated as a `PASS`
- true `Hail Mary` packages are filtered out of the normal recommendation pool
- true screen passes are now recognized as `screen`
- Goal Line packages are now suppressed outside true goal-line contexts
- a persistent in-app `Trace Log` section is available on the main screen

## Current Desktop UX

- topbar **OC | DC** toggles offense vs defense boards (DC enabled when the selected team has a defensive catalog); switching roles does **not** reshuffle either board’s top-3
- main hero flow is `Tap & Speak Situation` (OC board) or the same on the DC board for defensive calls
- DC board mirrors OC status with live `Heard` / `Situation`; sticky **Offense Showing** chips soft-bias the next defensive sheet
- after DC confirm, **Audible** / **Penalty** match OC patterns but stay on the defense learning path
- the app waits for the first real spoken situation before showing recommendations
- before game start, the secondary button shows `New Game` and opens the coordinator picker (OC and DC)
- after game start, that same button toggles `Game State` / `Hide Game State` on both boards (DC options are defense possession results; OC possession ends can auto-hand off to DC)
- the app shows live `Heard` and `Situation` status on the main screen
- a listening overlay appears during mic startup and active capture
- the mic button now has a clearer `Starting mic... Tap to cancel` state
- local Whisper capture auto-stops after about 1 second of silence
- the top recommendation can be read aloud automatically
- each recommendation tile includes a confirm circle so the user can mark the play that was actually run
- each tile also shows compact **why-this-call chips** (identity fit/lean/off-identity, cashes setup or sets up X, on-script, coverage beater when Last Defense Shown is known) plus an optional one-line note when those conflict
- a six-mode playcalling strip is available in the live recommendation UI (`Normal`, `2 Minute Drill`, `Kill Clock`, `Comeback`, `Blitz Beater`, `Redzone`); changing mode **immediately** rebuilds the current sheet (the other allowed regen besides Tap & Speak)
- a Game Scoreboard strip lets you set You/Opp score and quarter (**Q1–Q4 + OT**); that does **not** auto-switch modes and does **not** reshuffle the current sheet (bias applies on the next speak/mode regen)
- **Halftime** on the scoreboard stays visible (disabled until New Game); when enabled, pick a second-half coordinator style without resetting the game and the scoreboard moves to **Q3**
- after confirming a top-3 play, **Audible** lets you replace the logged call with another play from the same formation/set (sheet stays frozen)
- after confirm, **Penalty** lets you stamp a Madden flag so the next spoken situation does not false-train that package (`void_snap` undoes variety; `skip_learn` is report-only / no personal learning); re-confirm or audible keeps the stamp on the new pending outcome
- scoreboard edits update the scoreboard UI immediately; status coalesce still waits **450ms**; trace logs one `scoreboard-change` **2s** after you stop tapping score/quarter buttons
- spoken parsing accepts Whisper mishits like `intent`/`antenna` → and ten, `and go` → goal-to-go, `Nth down at Y`, field phrases like `on my 43` / `on the point 33`, `at the 50`, `26th` yard lines, and leading-digit guesses like `39 on my own 26`
- **Last Defense Shown** strip (**Blitz, Man, C1, C2, C3, C4, C6, C9, Tampa 2**) logs what Madden showed after the snap for opponent scouting; it does **not** reshuffle the current sheet and clears on the next Tap & Speak or playcalling-mode change (also New Drive / New Game / Clear)
- `Game State` opens the drive-result picker so the drive outcome can be scored and then reset; possession-ending OC results (not Quarter Expired / Just Reset / End Game / Sack) auto-switch to DC; OC Sack stays on Offense for yardage inference on the next speak; DC non-Sack Game State results auto-switch to OC
- **End Game** opens the Coordinator Report overlay (session trust, fidelity, leaders with 2+ samples, cumulative script hits, scouting matched vs logged, variety, learned notes; penalty snaps not scored) and resets playcalling mode to **Normal** (saved); **New Session** returns to team select
- a `Trace Log` section lets you open the current trace, export it, or start a fresh trace session
- a desktop settings panel now includes:
  - team selection
  - opponent selection (for scouting profile)
  - theme selection
  - voice engine selection
  - spoken recommendation toggle
  - voice picker
  - voice preview
  - voice refresh
  - Preferences card scrolls when content is taller than the window

## Current Recommendation Logic

The desktop app now uses the newer `Adaptive Playcalling` direction rather than a basic static ranking pass.

Confirmed current logic in `app.js`:

- down-and-distance situation buckets
- field-position buckets
- `CoordinatorPlan` scoring
- inferred defensive intent when defense is not spoken
- gain-fit scoring
- risk-control scoring
- team identity weighting
- setup-payoff and sequencing pressure (live chips + Coordinator Report `SETUP_PAYOFF` include expanded families: draw/iso/read_option/smash/verticals/levels_dig/curl_flat/snag_spot)
- live recommendation context chips (`buildRecommendationContextCore` in the shared core; display-only, does not change ranking). Coverage “Beats X” chips after Last Defense Shown are matchup labels for the logged look / scouting — they do not reshuffle the frozen sheet or re-coach the snap already run
- historical anti-repeat pressure
- recent-session anti-repeat pressure
- stronger drive-local formation and formation-set diversification
- stronger repeat penalties for exact plays that keep resurfacing inside the same formation/set shell
- penalties for plays and shells that keep reappearing in the top 3 without being selected (**shown exposure counts** for shell soft tax / #1 cooldown, not only confirms)
- same-family alternate-shell promotion when the hot #1 look is an overused formation|set
- formation context scoring
- goal-to-go handling
- spoken goal-to-go spot parsing (e.g. `1st and goal on the opponents 5` → spot 5, not forced to 1)
- true Goal Line suppression outside real goal-line contexts
- field-position-aware decision shaping
- true screen-family classification, with a **2026-09-09 reopen** so designed screens can again reach the top 3 (no longer tagged `outletHeavy`; softened high-variance risk; Constraint / Blitz Answer script families include `screen`; underexposure rare-family bonus includes `screen`)
- a mutually exclusive playcalling-mode overlay that biases the same core engine for hurry-up, clock-kill, comeback, Blitz Beater, and Redzone situations
- **Redzone mode** boosts smash, snag/spot, mesh/crossers (`man_beat`), levels/angle (`levels_dig`), power/duo, RPO, and counter while still mixing other concepts; **compressed** spots are `high_red_zone` or short GTG (≤~5 / short bucket when spot unknown)—long GTG uses open/high-red package lean; off-field Redzone mode is dampened (~0.35)
- Late-game coordinator-plan pressure (trailing hard) applies on **Normal** (and aligns with **Comeback**); explicit modes like Kill Clock / Blitz Beater / Redzone / 2 Minute are not overridden by that pass push
- **constrained multi-objective ranking** (shared core, **all teams**): objective-part caps (`situation`~24, `platform`~18 with ocBonus+mode+scoreboard) + Draw quotas, monopoly families (inside_zone / flood / boot / quick_game; monopoly **not** exempt under Blitz/Kill Clock/Blitz Beater), shown+confirmed shell rotation with soft tax retained on Kill Clock, stronger setup→payoff; PA/motion early-down identity lean is archetype-scoped (CHI/DET via core SOT); kill-switch `ENABLE_CONSTRAINED_RANKING` (default on)
- **recommendation exploration** (2026-09-15): when `ENABLE_RECOMMENDATION_EXPLORATION` is on (default), rank-1 is **sampled** from a near-tie band (~4.5 pts) via temperature softmax; situation MMR taxes shown/confirmed fingerprints and can hard-block a play that was #1 in the last two sheets for that situation; kill-switch the flag on Mobile + PC to restore legacy rank-1
- **selection engine** (2026-09-18; anti-repeat 2026-09-22): when `ENABLE_SELECTION_ENGINE` is on (default), Stage-2 `selectionEngine.js` builds the top-3 with batch-based shown bans, a **per-game session cap of 2** for any playId in the top-3, repeat tax, and underused wildcard preference (replaces pickTop); kill-switch the flag on Mobile + PC to restore pickTop/exploration
- scoreboard soft-bias from You/Opp score + quarter (Q1–Q4 + OT; OT treated like Q4 for late-game lean) on the **next** speak/mode regen; **Normal** full lean, **Comeback/Kill Clock** aligned lean only, other explicit modes zero; does not unlock Hail Marys or reshuffle the live sheet
- soft personal learning from inferred outcomes across spoken situations (learning keys include playcalling mode; legacy keys still soft-apply)
- in-game outcome memory (drive + game) that demotes families/formations/plays after recent failures
- general variety penalties dampened so situational fit and script bonuses can still separate #1; **formation|set exposure penalties are undampened** so recycled looks lose the sheet sooner; with **exploration on**, **historical** variety is also undampened and rank-1 uses sampleRank1 instead of pure argmax
- late-game coordinator-plan pressure when trailing hard or Comeback is active
- turnover-risk penalties for shot / deep PA / leak / high-variance concepts when stabilizing from backed-up or coming-out field
- opponent scouting (predictive pre-snap when defense is Unknown + ≥2 observations; Last Defense Shown builds scout history and clears before the next speak/mode regen so reactive carryover does not steer the next top 3). Changing opponent in Settings does not reshuffle the current sheet
- defense tendency history from logged coverages (session + persisted history, with opponent-scouting fallback when opponent is set)

Supported spoken examples:

- `3rd and 6`
- `2nd and 8 cover 3`
- `1st and goal on the 4`
- `2nd and goal on the opponents 8 yard line`
- `3rd down and 5 on my own 30 yard line`
- `First and go on the opponent 6` (goal-to-go)
- `Third down at 7 on the opponent's 39`
- `First in 10 on my 43 yard line`
- `1st and 10 at the 50`
- `3rd and 9 on my own 26th`
- `39 on my own 26` (leading-digit guess → 3rd & 9 at own 26)
- Whisper-tolerant: `First intent on the opponent's 21`, `First antenna my own 24`, `on the point 33`

## Voice and Persistence

- speech recognition uses local Whisper packaged with the app
- spoken play readout (Kokoro TTS) was removed 2026-09-18 — recommendations are visual only on desktop
- preferences are persisted locally for selected team, **opponent**, theme, and selected playcalling mode (`preferences.json` under Electron `userData`); **End Game** writes the mode back to **Normal** so the next launch does not keep 2 Minute Drill, Kill Clock, Comeback, Blitz Beater, or Redzone
- **opponent scouting, defense tendency, personal learning, and play-history anti-repeat** are persisted in renderer `localStorage` (`goc-desktop-user-learning-v1`, `goc-desktop-play-history-v1`)
- game scoreboard (You/Opp/quarter/OT) is live session state only — resets with New Game / End Game and is not in preferences
- current-game scouting log (`gameScoutingLog`) is session-only — cleared on New Game / End Game
- current-game outcome memory (`gameOutcomeMemory` / `driveOutcomeMemory`) is session-only — cleared on New Game / End Game (drive memory also clears on new drive)
- uninstall/reinstall on the **same Windows user profile** normally **keeps** scouting history because NSIS does not delete `userData` by default; manually deleting `%APPDATA%\Gridiron Play Advisor\` wipes it
- the trace log is also persisted locally and can be exported from the app

## Main Files

- `package.json` - Electron config, scripts, and Windows packaging settings
- `shared/recommendationCore.js` - synced desktop copy of the shared recommendation core (includes `buildRecommendationContextCore` for live tile chips)
- `shared/selectionEngine.js` - Stage-2 OC/DC slate builder (batch shown bans / session play cap / diversity buckets / complementary counter-pairing); flag `ENABLE_SELECTION_ENGINE`
- `shared/defenseRecommendationCore.js` - synced DC top-3 scorer (MAN/ZONE/MATCH/ZONE_BLITZ/MAN_BLITZ by down/distance/field; Offense Showing soft-bias helpers; realistic blitz surfacing)
- `shared/coordinatorReport.js` - synced desktop copy of the End Game Coordinator Report builder (script beats / scouting matchup / Success minSamples + penalty-safe outcomes as of 2026-09-11)
- `shared/penaltyCatalog.js` - synced Madden penalty catalog + learning-gate helpers for the post-confirm Penalty picker
- `scripts/check-pc-core.mjs` — validates all 5 shared modules locally (sync is retired)
- `scripts/after-pack-win-icon.mjs` — embeds `assets/icon.ico` into the packaged Windows `.exe` after pack
- `scripts/measure-gridiron-usage.ps1` - portable CPU/memory recorder for a running Gridiron OC session (copy the script to another PC; logs under `%TEMP%\GridironUsage\`)
- `scripts/smoke-situation-parse.mjs` - spoken-situation parse smoke (Whisper alias / goal-to-go / field phrases / midfield / ordinals / digit guess)
- `scripts/smoke-scoreboard-bias.mjs` - late-game scoreboard bias / mode-dampen smoke (includes OT=Q4 case)
- `scripts/smoke-defense-tendency.mjs` - reactive defense-tendency smoke
- `scripts/smoke-opponent-scouting.mjs` - opponent scouting predictive/reactive layering smoke
- `scripts/patch-dc-*.mjs` - one-shot DC wiring helpers (dev)
- Repo-root smokes (from `Gridiron_OC/`): `scripts/smoke-halftime-style.mjs` (Coordinator Report style segments), `scripts/smoke-audible-shell.mjs` (same formation/set audible candidates), `scripts/smoke-penalty-outcomes.mjs` (void vs skip_learn learning gates) — note these are referenced from the Mobile parity era and may not exist in this checkout
- Marketing site: `../Website/README.md`
- `build/installer.nsh` - NSIS `customInstall` shortcut icon override
- `main.js` - Electron main process (plays/trace IPC, Whisper helpers)
- `preload.js` - safe bridge for `plays.json`, `defensive_plays.json`, and trace-log actions
- `ocr/main/**` - isolated hotkey, worker supervision, Capture Bridge ingest, versioned profile/event storage, diagnostics, and restricted OCR orchestration
- `ocr/shared/**` - pure catalog resolution, consensus, state validation, exact-play ranking, snap attribution, and bounded learning modules
- `ocr/renderer/ocr-ui.js` - PC-only calibration (Capture Bridge), presentation styles, and OCR Fast Call strip (status only; play tiles live in Recommendations)
- `ocr-sidecar/**` - local JSON-lines capture/OCR worker (Capture Bridge maps) and PyInstaller onedir build
- `capture-bridge/**` - Windows Cap V1 frame publisher (`GridironCaptureBridge.exe`)
- `OCR_DC_GUIDE.md` - setup, rollout gates, data controls, verification, and rollback
- `vendor/whisper/**` - bundled local Whisper runtime and model assets for speech recognition
- `index.html` - desktop markup and overlays (including OC|DC workspaces and Coordinator Report)
- `styles.css` - desktop styling and theme tokens
- `app.js` - desktop voice flow, parsing, OC + DC recommendations, persistence, learning, and End Game report
- `plays.json` - synced play database (**gitignored**; keep Mobile/PC copies in parity). 2026-09-04 Madden type corrections (jet-pass/shovel→PASS, stretch-alert bubble/X lookie/U pop→RPO, plus confirmed one-offs) are local until packaged from the corrected file.
- `defensive_plays.json` - defensive catalog for the DC board (**gitignored**; **32 teams / 8,214 plays** as of 2026-09-15; keep Mobile/PC copies in parity; packaging must ship the expanded local file)
- `assets/icon.ico` - packaged Windows app icon
- `assets/icon.png` - runtime desktop icon
## Run Locally

```powershell
npm install
npm start
```

Madden OCR DC is experimental and disabled by default. Capture uses the
bundled **Capture Bridge** (capture card or PC window). Calibrate a profile before enabling capture. See `OCR_DC_GUIDE.md`.
Build the bridge with `npm run build:capture-bridge` (also runs during `npm run dist`).

The `start` script clears `ELECTRON_RUN_AS_NODE` first because that env var can break Electron startup in this environment.

## Build Installer

**Option A — double-click (from `PC\dist` after a prior build):**

```powershell
cd "D:\Robert\Desktop\App Project Builds\Gridiron_OC\Gridiron_OC\PC\dist"
.\rebuild-installer.cmd
```

**Option B — manual:**

```powershell
cd "D:\Robert\Desktop\App Project Builds\Gridiron_OC\Gridiron_OC\PC"
$env:ALLOW_GPL_FFMPEG="true"
npm run dist
```

`npm run dist` now rebuilds and tests the local OCR onedir worker, runs its
license guard, and packages it with the app. Useful OCR-only checks:

```powershell
npm run test:ocr
npm run build:ocr-worker
npm run check:ocr-license
npm run benchmark:ocr -- .\ocr-golden\private\manifest.json
```

The installer build packages the app into `PC\dist\`. `ALLOW_GPL_FFMPEG=true` is required for intentional internal builds while the bundled FFmpeg still reports `--enable-gpl`. `rebuild-installer.cmd` sets that override, increments the patch version, and if `dist\win-unpacked` is locked builds in `%TEMP%\gridiron-play-advisor-pack` before copying the setup exe back.

Current installer output:

- `dist\Gridiron Play Advisor Setup 0.1.3.exe`

Helper scripts in `dist\` (gitignored; recreate if missing):

- `dist\rebuild-installer.cmd`
- `dist\rebuild-installer.ps1`

The main source files such as `app.js`, `main.js`, `preload.js`, `index.html`, and `styles.css` should remain untouched by the build itself.

## Current Notes

- the installer product name still uses `Gridiron Play Advisor`, even though the in-app branding is now `Gridiron OC`
- live mic behavior should still be validated in the installed app with a real headset
- speech recognition availability still depends on the Electron runtime on the machine
- confirmed-play attribution and the optional drive-result picker now exist on desktop too
- the narrower recommendation safety fixes, including screen recognition / **screen top-sheet reopen**, and stronger shell anti-repeat tuning (shown+confirmed formation|set rotation), now exist in both apps, with Hail Mary filtering and Goal Line suppression already treated as resolved behavior
- spoken goal-to-go spot parsing (not forced-to-1) and repeated-top-3 exposure penalties now exist in both apps
- the same six playcalling modes now exist in both the PC and mobile apps, but they still need real gameplay validation before the tuning should be treated as final
- Opponent scouting, Last Defense Shown logging, Game Scoreboard soft-bias, and Coordinator Report scouting are now on **both** PC and Mobile (Mobile helpers in `Mobile/shared/defenseScouting.js`)
- Local packaged installer is `dist\Gridiron Play Advisor Setup 0.1.3.exe` (2026-09-24, `rebuild-installer.ps1`). It includes the OBS removal, OCR scouting log, confirm scoring, long-yardage and Default-font HUD repairs, OCR Exact Call variety, and the DC goal-line gate. The published GitHub release [v0.1.1](https://github.com/GenNowGamer/Gridiron-OC-PC/releases/tag/v0.1.1) is still the older installer.
- Website production cleanup done (2026-09-16): `/api/ai/*` removed, Netlify AI env vars deleted, OpenAI key revoked
- The 2026-09-24 local installer `0.1.3` is the current packaged build. The GitHub Releases download is not: [v0.1.1](https://github.com/GenNowGamer/Gridiron-OC-PC/releases/tag/v0.1.1) predates the OBS removal and the later OCR repairs.
- Madden OCR DC source is isolated behind three switches that default off. Capture
  ingest is **Capture Bridge**.
  Tesseract/ONNX workers package locally; neural-model redistribution, the private
  golden-dataset accuracy gate, Bridge burst ≤700 ms, and the 100-snap installed-app
  live gate must pass before any OCR switch can default on.
- **OCR Exact Calls (2026-09-17):** OC-style Confirm + Audible/Penalty on generated
  defensive tiles; critical gate is down/distance + field position +
  formation/personnel only (previous-play ROIs optional for drive openers).
  Down/distance uses grammar/catalog + confusable repair (no digit whitelist);
  field-position burst consensus filters leading-digit bleed when a shorter yard
  also appears. Operator guide: `OCR_DC_GUIDE.md`.
- **OCR Exact Calls hardening (2026-09-18):** Review corrections re-parse field
  position / down-distance / I Form; HUD repairs for `2N0`/`SRO`/`TH & Inches`;
  Exact Call ranking uses confirmed + shown-sheet variety so top-3 shells rotate.
  Bare yard **50** is accepted as midfield (no OWN/OPP required) so Exact Calls
  are not blocked at the 50. CHI catalog: only **4-3 | Over** → **Cover 3 Cloud Str**
  (other CHI Cloud shells stay plain Cloud). Verify: `node scripts/smoke-ocr-domain.mjs`.
- **OCR OC/DC UX (2026-09-21):** Shared presentation-style profiles (TNF/MNF/SNF/
  Default); formation crop required at calibration but **OC runtime** only gates
  on down/distance + field; **DC Exact Calls** still need formation. Play tiles
  live only in **Recommendations** (Exact Call or Package Call) — not in the OCR
  Fast Call strip. Field-side vision prefers triangle contours beside yard digits.
  Fixed Exact Calls ↔ `render()` re-entry that slowed OC↔DC switches. Guide:
  `OCR_DC_GUIDE.md`. Rebuild OCR worker/installer before shipping sidecar changes.
- **OCR HUD / anti-stale (2026-09-22):** HUD repairs for pipe-bleed on real 21/31
  yards, `INGHES`, COVER/BUZZ/BLITZ glue, OC junk formation empty; OCR same-spot
  re-fire within 2.5s does not double-record recommendation exposure. Prefer
  `gridiron-trace-current.txt` for top-3 analysis (OCR JSON export has no slates).
  Afternoon follow-up: Capture Bridge default + 4K60 Pro crash fix; Goal/Cover/
  personnel/play-glue repairs from live exports (`BOAL`, `COVERA…`, `IRBITE…`,
  `HBSLIPSCREEN`, …). Verify: `node PC/scripts/smoke-ocr-domain.mjs`
   `node scripts/smoke-ocr-domain.mjs`. Rebuild Bridge + sidecar + installer
  before shipping.
- **OC selection engine (2026-09-18; anti-repeat 2026-09-22):** Stage-2
  `selectionEngine.js` on by default with session play cap = 2 and batch-based
  shown bans. Live-test same-spot speaks for top-3 rotation. Verify:
  `node --test ./scripts/test-app-regressions.cjs`.
- mobile still uses Android system TTS for optional readback; desktop has no TTS path after Kokoro removal
- a normal packaged installer build is expected to preserve the current theme-persistence fix because settings are stored outside the app bundle
- public distribution still needs installed-build validation for theme persistence, Whisper speech recognition, and trace export before treating the desktop app as release-ready (rebuild after 2026-09-18 to drop Kokoro from the installer)
- after scoreboard/parse/scouting changes, re-validate with a live headset game and/or:
  - `node scripts/smoke-situation-parse.mjs`
  - `node scripts/smoke-scoreboard-bias.mjs`
  - `node scripts/smoke-defense-tendency.mjs`
  - `node scripts/smoke-opponent-scouting.mjs`
- third-party attribution file: `THIRD_PARTY_NOTICES.md`
- local copied license texts: `licenses/`
- `npm run dist` now runs an FFmpeg license guard and blocks by default if the bundled FFmpeg is GPL-enabled

## Trademark / Non-Affiliation

Gridiron OC is an independent companion app and is not affiliated with, endorsed by, sponsored by, or approved by Electronic Arts, EA SPORTS, the NFL, or any league/team rights holder.

For store listing copy, use:
- `../STORE_LISTING_DISCLAIMER.md`
- `../STORE_LISTING_COPY.md`

## Privacy / Support

- Privacy policy draft: `../PRIVACY_POLICY.md`
- Support contact checklist: `../SUPPORT.md`
- Store submission hygiene report: `../STORE_SUBMISSION_HYGIENE_REPORT.md`
