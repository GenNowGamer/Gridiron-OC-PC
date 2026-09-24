# Madden OCR DC release validation

All three OCR switches remain off until every applicable gate is checked.

## Automated

- [x] `npm run test:ocr`
- [ ] Existing OC/DC smoke suites pass
- [x] `npm run benchmark:ocr` against `ocr-golden/fixtures/manifest.json` (synthetic mock gate)
- [x] `npm run build:ocr-worker`
- [x] Packaged worker responds to `hello` and reports production OCR engines
- [x] `npm run check:ocr-license`
- [x] `npm run build:capture-bridge` → `capture-bridge/dist/GridironCaptureBridge.exe`
- [x] `npm run verify:ocr-package` (automated subset)
- [ ] Private Madden golden benchmark: accepted-field precision ≥99%
- [ ] Private Madden golden benchmark: usable recall ≥95%
- [ ] Private Madden golden benchmark: warm worker p95 ≤800 ms
- [x] `npm run dist` (installer built; OCR worker under `resources/ocr-worker`)

## Capture adapters

- [x] Capture uses Capture Bridge only (`capture-bridge`)
- [x] Intended Xbox capture-card or Madden window selected in Calibrate capture
- [ ] Capture Bridge 3-frame burst p95 ≤ 700 ms on validation hardware
- [ ] Elgato / 4K60 Pro (or target card): Capture Reference succeeds with HDMI live and no other app holding the device
- [ ] Unpackaged or rebuilt sidecar accepts adapter `capture-bridge`
- [ ] Saved profile resolution/aspect matches live source
- [ ] Presentation label mismatch is rejected when provided
- [x] At least 20 capture-only samples
- [x] Stable frames; stale frames = 0 (QPC/sourceSequence when plugin metadata is present)
- [x] Capture-only burst p95 ≤700 ms (measured p95 ≈ 204 ms at 2560×1440, 3 frames × 20 bursts)
- [ ] Disconnect/reconnect produces a clear status and recovers
- [ ] Duplicate shortcut presses cause one capture

## Shadow mode

- [ ] OCR Capture on; Exact Calls and OCR Learning off
- [ ] Raw and processed crops inspected for every drawn ROI
- [ ] Unknown/conflicting values are withheld (including bare down/distance digit soup)
- [ ] Presentation mismatch is rejected
- [ ] Penalties, turnovers, quarter changes, and drive handoffs labeled
- [ ] No OC state or recommendation regression

## Exact Calls live checks

- [ ] Critical DC situation fields: down/distance, field position, formation/personnel
- [ ] OC OCR situation sync accepts with down/distance + field only (formation not required at runtime)
- [ ] Shared presentation style (TNF/MNF/SNF/Default) loads the same profile on OC and DC
- [ ] Exact Call tiles appear under **Recommendations** (not inside OCR Fast Call strip)
- [ ] Package Call tiles appear under Recommendations when Exact Calls is off / Tap & Speak
- [ ] First snap of a drive generates Exact Calls without previous-play ROIs
- [ ] Confirm → Audible / Penalty pickers work on Exact Call tiles in Recommendations
- [ ] Down/distance confusable/ornament cases parse (`SRD & A`, `1s™ &10`, `2N0 & 6`, `SRO & 18`, `TH & INCHES`, Goal `BOAL`/`G0AL`/`60AL`) or fail closed
- [ ] Field position spaced bleed / pre-arrow digits resolve; `¥35`→OWN; trailing `451`→45 (not 51); true OWN 45 kept when no competing `5`
- [ ] Digit-dominant field crop (`▼ 34` with large digits) accepts OWN/OPP via vision when text is bare yards
- [ ] Bare midfield **50** (no OWN/OPP) accepts and does not block Exact Calls
- [ ] Review correction of field position uses `OWN`/`OPP` + yard and feeds Exact Call geography (yard-only stays unaccepted, except midfield 50)
- [ ] Dropped **I Form** (`Form - Wing`) and glued personnel (`IRBITEIAWR`) repair on capture or correction
- [ ] Previous-play glue repairs catalog-match (`COVERAQUARTERS`, `COVERIHOLE`, `HBSLIPSCREEN`, `COVBUZZMATCH`, `NSDEZONESPLIT`)
- [ ] After 2–3 Exact Call confirms on similar Gun spots, top-3 shells rotate (not the same Cover 3 Cloud trio every snap)
- [ ] CHI: **4-3 Over** Exact/catalog name is **Cover 3 Cloud Str**; other CHI Cloud shells stay plain **Cover 3 Cloud**
- [ ] OC↔DC role switch feels instant (no multi-second freeze from nested renders)

## Installed-app live gate

- [x] Installer completes and launches
- [x] Worker starts without Python installed/on PATH
- [ ] Trigger-to-recommendation p95 ≤2.0 seconds
- [ ] Critical accepted-field precision ≥99% (down/distance, field, formation/personnel)
- [ ] Prior defensive-play attribution correct across ≥100 labeled snaps (when previous-play ROIs are used)
- [ ] Zero low-confidence snap learning
- [ ] Correction and undo rebuild learning correctly
- [ ] Export contains no raw frames or stored capture passwords
- [ ] Reset-opponent and full-delete controls verified
- [ ] Existing DC v2 remains immediately usable after all OCR switches turn off

If a gate fails, stop with OCR disabled. Do not substitute cloud OCR, custom
training, a larger model, or lower confidence thresholds without a new explicit
decision. Capture Bridge is the only OCR ingest path.
