# Chicago–Philadelphia session review

Fixes delivered in PC installer **0.1.5**.

Reviewed the OCR export ending `2026-09-25T07-58-52-840Z` and `Trace log ChiVSPhi.txt`. The export also contains older games; this review isolates September 25, 07:08–07:54 UTC (02:08–02:54 Central). The final recorded score was 7–3.

## Findings

The prior patch was working in several areas, but defensive learning was **not fully correct**.

- The session contains 56 captures and five correction saves (61 decision records). Those saves changed seven field values; the other fields saved alongside them were unchanged.
- Offense: 27 confirmations, all different plays. The trace records 19 next-snap learning outcomes, four skips, three drive-ending learning entries, and one final confirmation without a subsequent outcome. Both logged offensive holding penalties were skipped. Two other outcomes were withheld for insufficient evidence.
- Variety: all 27 confirmed defensive Exact Calls were different, too. Across 29 printed offensive recommendation sheets, no play appeared more than twice. This supports the intended repetition behavior in this game; it does not prove every future situation will be correct.
- Defensive learning: 16 snap records were written. Seven used a different formation/set from the confirmed call despite having the same play name. For example, confirmed Nickel / 2-4 Dbl Mug / 2 Invert Hard Flat was credited to 4-3 / Over Solid. OCR supplies the name, and the catalog previously selected the first matching formation.
- At 07:44:01 UTC, offensive holding was logged against the defensive call. The next capture at 07:44:09 nevertheless recorded a learnable 10-yard loss against 1 LB Blitz. The defensive penalty control was not connected to the OCR learning manager.
- The corrected ZERO BLITZ at 07:30 was recorded without a defensive play ID. Changed play names were saved as plain text. A correction made after an event had already been learned also did not update that event.
- Five captures accepted impossible personnel totals: `1RB 3TE 0WR`, `1RB 3TE 3WR` (three occurrences), and `1RB 2TE 1WR`. The export does not establish the intended counts, so the repair requires review rather than inventing them.

## Parser repairs

| OCR reading | Verified correction |
| --- | --- |
| `REDZONEBSISRS` | REDZONE SCISSORS |
| `ZEROBITZ` | ZERO BLITZ |
| `cYaalb` | Empty previous-play field |
| `Y'3'B` with independent OWN side hint | OWN 38 |
| `LBROS` | LB CROSS 3 SHOW 2 |
| `CORERSTRKE` | CORNER STRIKE |
| `LOPHOTBLITZ` | LOOP HOT BLITZ 3 |

These are narrow repairs based on the saved corrections. General matching thresholds were not lowered. Intact ZERO, LOOP, LB, LEVELS, and football position abbreviations are also protected from incorrect number/prefix conversion.

## Learning and correction repairs

- Confirmations, audibles, and penalties from the OCR Exact Calls board now reach the main-process pending snap through the desktop bridge. The association is transient and tied to the current capture.
- When the observed defensive name agrees with the confirmed call, learning uses that call's exact formation/set identity. A different observed name is not replaced by the recommendation.
- Logged defensive penalties make the outcome ineligible for learning. The next distinct situation clears the previous call and penalty; a repeated capture of the same spot preserves the current pending call.
- Manual play corrections resolve against the appropriate team's catalog. Unknown free-text names cannot create a defensive learning record with no play ID.
- Corrections reconcile from the original pre-snap baseline, update the subsequent baseline, and replace the capture's learning through an append-only correction event. Repeated corrections cannot count the same snap twice. Clearing a mistaken play removes its previous learning contribution. Undo recognizes corrected records.
- Impossible full personnel counts are withheld for review.

## Validation and limits

All seven manually corrected fields pass tests through the production field resolver using their original confidence, agreement, and side hint. Replaying all 56 original captures retained every previously accepted field except the five invalid personnel readings. Other improvements included HB SLIP SCREEN and LEVELS DIG. One earlier LOOP HOT BLITZ capture remains reviewable because its confidence/agreement did not pass the existing gates.

The hidden desktop smoke test uses the real main process, preload, renderer, catalogs, and a disposable profile. It checks offensive penalty safety, coordinator switching, OCR resets, defensive confirmation identity, penalty transmission, exclusion from learning, and clearing before the next confirmation. Synthetic OCR fields replace capture hardware for this test.

The installer build also runs the full PC regression pipeline, including all 32 teams across six offensive scenarios and the existing OCR/defensive domain checks. Scoring weights and the football-fit/learning foundation were not changed in this update.

Final validation passed: 12 application regressions (including the 192-case team/scenario matrix), 28 OCR main-process tests, 51 OCR domain checks, and eight defensive-situation checks. The packaged 0.1.5 desktop smoke also passed the audible bridge test. Twelve packaged source/core files matched the checkout byte-for-byte. Both native helpers rebuilt successfully; the .NET build reported an unavailable vulnerability-data service but completed using its restored dependencies. Packaging used the existing internal-build FFmpeg setting from the rebuild workflow.

This is a replay and code review, not another live capture-card game. The logs cannot establish the ground truth of every unedited OCR field or every on-field outcome. Saved profiles and historical learning were not edited; installing the update prevents these paths from adding new bad records but does not retroactively repair the already recorded session. Work and packaging use only the PC checkout, with no Mobile/shared access.

## Installer

`PC/dist/Gridiron Play Advisor Setup 0.1.5.exe` — 450,506,343 bytes.

SHA-256: `DA39BAFD424F426F29F8C29D13B3AE68F382FC9C70030A5771D5D68DC5819B83`.
