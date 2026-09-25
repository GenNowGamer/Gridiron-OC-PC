# Gridiron OC PC 0.1.4 — changes and verification

Completed 2026-09-25. Work was confined to this PC checkout. Mobile/shared was not accessed during implementation.

## Changes

- PC/shared is authoritative. Launch and both installer output paths validate local modules instead of copying Mobile files. The obsolete sync script now stops with an explanatory error.
- OC selection preserves the capped football-fit, identity, learning, historical-variety, novelty, and mode/scoreboard score. Selection adds repetition penalties and diversity without reweighting uncapped components or applying learning again. Random jitter is counted once.
- OC whole-game appearance counters are independent of the rolling recent-history list. Batch IDs are monotonic. Exact Call sheets also remain remembered for the entire game. New Game clears these game counters; a drive reset does not.
- Terminal outcomes honor the existing void-snap/skip-learning penalty gates, including report handling and voided recent usage.
- OCR recapturing the same spot does not manufacture another snap. Real zero-yard plays with down progression remain learnable. Attribution advances while learning is disabled.
- OCR attribution resets at drive/game/team/opponent/role boundaries without deleting the learning ledger. OC captures do not train DC effectiveness. Captures in flight across a reset are rejected.
- OCR configuration writes are serialized to prevent competing Windows file replacements during rapid context updates.
- The installer now requires PC regressions and OCR JavaScript checks before rebuilding the OCR worker and Capture Bridge. Its locked-output fallback runs the same full pipeline. Process cleanup is limited to this checkout and its packaging directory.

## Verification

- 12 production-renderer/scoring regression tests passed, including 192 team/mode/situation cases across all 32 teams.
- 13 OCR main-process tests passed, including duplicate captures, learning toggles, session reset, role/opponent boundaries, stale in-flight captures, and serialized settings writes.
- 51 OCR domain checks passed.
- 8 defensive-situation checks passed.
- 42 Python worker tests passed during the installer build.
- Changed runtime files passed JavaScript syntax checks.
- Six controlled before/after rank-one comparisons across CHI, KC, and BAL: five retained the same play; one changed with the corrected scoring. Scores are intentionally different where the old selector bypassed caps.
- Packaged source smoke passed in a hidden Electron window with a separate disposable profile: 13,793 offensive plays, 8,214 defensive plays, three OC recommendations, three DC packages, penalty-safe terminal handling, and OCR reset. The harness changes only window visibility in memory; it does not edit the package.
- Nine packaged runtime/catalog files matched the corresponding source files byte-for-byte, including the final settings-write fix.
- Installer completed successfully using the existing Electron Builder/NSIS pipeline. Both helper executables were rebuilt. Existing packaging identity, icons, and runtime dependency versions were retained.

## Installer

`dist/Gridiron Play Advisor Setup 0.1.4.exe`

Size: 450,504,565 bytes.

SHA-256: `C33E5B89DA272E1458D2B861CE70B5AC8493241E44C283AC456ADCB4D7DBA982`

Original edited files are saved under `../review-backup-2026-09-25/PC/`. The original 0.1.3 installer remains in dist.

## Limits and remaining review items

The new installer has not been installed over the user's existing installation. Physical microphone/capture-card gameplay and OCR accuracy/latency require live testing. The desktop smoke exercises packaged application code with an isolated profile; it is not a full hardware or installer-upgrade test.

Existing saved learning was not rewritten or erased. Historical incorrect observations cannot be reliably reconstructed from this review alone.

Unrelated review findings (dead-code cleanup, diagnostic-image deletion, broader documentation contradictions, and legacy smoke scripts that copy implementation logic) were not part of these targeted learning/scoring fixes.

The build used the existing internal FFmpeg override. The .NET build succeeded with cached dependencies; its online package-vulnerability lookup reported a NuGet connectivity warning. Neither dependency upgrades nor distribution-license policy changes were included.
