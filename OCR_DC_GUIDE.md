# Madden OCR Defensive Coordinator

Status: experimental, PC-only, disabled by default.

The OCR path is isolated from the existing OC and DC v2 package callers. It never
sends gameplay images or recognized text to Netlify or another cloud service,
and it does not control Madden, OBS, Xbox, a controller, or keyboard input.

## Runtime files

OCR data is stored separately under Electron's `userData` directory:

- `vision-profiles-v1.json` — capture settings and normalized calibration profiles
- `dc-snap-log-v1.jsonl` — append-only accepted/corrected/undo event ledger
- `dc-learning-v1.json` — rebuildable opponent and defensive-effectiveness projection

Raw frames are transient. A future debug-retention mode must be explicitly
enabled before any frame bundle can be retained.

## Capture setup (default: Capture Bridge)

1. Prefer **Capture Bridge** (bundled with Gridiron OC). No OBS install is required.
2. In Gridiron OC Settings, open **Calibrate capture**, confirm **Capture adapter** is
   **Capture Bridge (default)**, then click **Refresh sources**.
3. Choose a **capture card** (Xbox HDMI) or a **PC window** (Madden on this PC).
   For PC windows, use borderless or windowed mode — exclusive fullscreen often
   captures black frames.
4. Capture a reference image. Choose a **presentation style** (TNF / MNF / SNF /
   Default) so OC and DC can share one calibrated profile per broadcast layout.
   Draw each required region, test it, and save the profile. Calibration still
   requires **Down / distance**, **Field position**, and **Upcoming Formation /
   Personnel** (one box over the Madden line such as
   `Gun - Deuce close - 1 RB 2 TE 2 WR`) so shared styles keep the DC crop.
   **Runtime gates differ by role:** OC situation sync only needs down/distance
   + field position; DC Exact Calls also need formation/personnel accepted.
   **Previous offensive play** and **Previous defensive play** are optional —
   leave them undrawn or empty on the first snap of a drive; Exact Calls do not
   wait on those ROIs. For TNF, draw **Field position** wide enough to include
   both the yard number and the small **up/down** arrow beside it (down arrow =
   OWN, up arrow = OPP). Ignore left/right chevrons elsewhere on the scoreboard;
   they are not the field-side ROI. Do **not** OCR score or quarter — OCR reads
   **You / Opp / Q1–OT** from the OC Game Scoreboard controls and uses that for
   OC/DC situation and Exact Calls. Re-save any older profile that still has
   score/quarter boxes so those ROIs are dropped. Use the DC **Penalty** picker
   for flags — do not OCR penalty text. Regions use normalized coordinates and
   are rejected when the source aspect ratio changes materially.
5. After enabling **OCR Capture**, wait until the OCR Fast Call strip shows
   **Ready** (the worker warms the OCR engine once in the background). Do not
   raise capture timeouts to paper over a cold engine — warm-up is separate from
   the live burst path. The strip shows status/context only — it does **not**
   host play-call tiles.
6. Re-open **Calibrate capture** to reload the last saved profile (regions +
   reference). Use **Saved profile** / presentation style to switch among stored
   profiles.

### Legacy backup: OBS Studio

Keep OBS available if Capture Bridge cannot open your card or meets the latency
gate. Manual switch only — Gridiron does **not** auto-fallback.

1. In OBS 28 or newer, open **Tools > WebSocket Server Settings**.
2. Enable the WebSocket server, keep it bound to the local machine, and note its
   port and password. The default port is `4455`.
3. Install the native shared-frame plugin (required for the OBS capture latency gate):

```powershell
cd PC
npm run build:obs-plugin
# Copy dist output into OBS (admin shell):
Copy-Item .\obs-plugin\dist\64bit\gridiron-ocr-capture.dll `
  "C:\Program Files\obs-studio\obs-plugins\64bit\"
```

   Restart OBS and confirm the log shows `[gridiron-ocr-capture] shared-frame bridge loaded`.
4. Add the Xbox capture card or Madden scene to OBS and confirm that its source
   is visible and stable.
5. In Gridiron OC Settings, open **Calibrate capture**, set **Capture adapter** to
   **OBS plugin (legacy)**, connect, and choose the raw source or scene.
6. Capture a reference and save ROIs the same way as the Bridge path above.

Catalog / parse notes continue below (unchanged from Bridge vs OBS — OCR engines
are shared).

7. Catalog play fields fail closed when raw OCR disagrees with the matched
   play name (prevents false accepts like `FS FIRE 1` → `4-3 Under`).
   Formation/personnel ROIs use multiline OCR (PSM 6).
8. **Down / distance** is parsed with a grammar + finite legal catalog (downs
    1–4 × yards 1–40 + Goal). Bare digit soup (`34`, `2010`) is rejected;
    structured OCR with confusable glyphs (`SRD & A`, `1s™ &10`, `2N0 & 6`,
    `SRO & 18`, bare `TH & INCHES` / `INGHES` / `MGHES` → inches→1,
    Goal OCR `BOAL` / `G0AL` / `60AL` → `& Goal`) is repaired via ordinal-suffix /
    Inches / Goal rules. That ROI uses **no Tesseract char whitelist**. Burst
    consensus prefers frames that still show ordinal/`&` structure. Trailing
    `|`→`1` pipe-bleed is only stripped after a full two-digit yard (`261`→`26`),
    never from real `21`/`31`/`41` lines.
9. **Field position** takes the last digit group when spaced bleed appears
    (`4 5` → `5`), strips digits before the TNF arrow (`4v5` → `5`), maps yen
    `¥35` → OWN 35, and applies trailing-`1` pipe-bleed (`451`→`45`) **before**
    the 4xx bleed rule (so `451` does not become invalid `51`). In a burst,
    drops a longer yard (`45`) only when a competing shorter yard (`5`) also
    appears (so true OWN 45 is kept). Vision arrow detection scores left-of-digits
    **triangles** so bare OCR text like `34` can still accept as `OWN 34` /
    `OPP 34` when the up/down glyph is in the crop. Manual Review corrections
    must use `OWN`/`OPP` + yard so geography feeds Exact Call scoring; yard-only
    stays unaccepted **except bare midfield `50`**.
10. **Formation / personnel** repairs a dropped leading **I** on I Form
    (`| Form - Wing` / `Form - Close` → `I Form`), glued bars (`IRBITEIAWR` /
    `RBITEIAWR` → `1RB - 1TE 3WR`, TE=`I`→1), and common glue typos such as
    `OTE`→`0TE`. OC chrome junk (`cYal`, lonely brackets) fails closed as empty.
11. **Previous-play text** repairs cover digit confusables (`COVERAQUARTERS`→
    Cover 4, `COVERIHOLE`→Cover 1, `COVERBCLOUD`→Cover 3), truncated `COV…`,
    blitz glue, `NSDE`/`NSIDE`→INSIDE, HB glue (`HBSLIPSCREEN`, `HBLEAD`),
    `L DOUBLE`→`1 DOUBLE`, `FELD`→FIELD, and spaced tokens (`MTN EMPTY…`,
    `DOUBLE BRACKET SWITCH`) before catalog match.

## Troubleshooting (Capture Bridge)

- **Reference fails / process exit `3221226505`:** Usually Capture Bridge abort
  (MF/thread), not the OCR sidecar. Fully quit Gridiron and OBS (card exclusive),
  ensure HDMI is live, use the rebuilt Bridge under `capture-bridge/dist`.
- **`adapter must be one of: websocket, obs-plugin`:** Stale frozen sidecar —
  rebuild with `PC/ocr-sidecar/build-sidecar.ps1` (or run unpackaged so Electron
  uses `.venv` Python with current source).
- **`opencv is unavailable: No module named 'cv2'`:** Unpackaged launch was
  using system Python. Prefer `ocr-sidecar/.venv` (default now) or force frozen
  with `GRIDIRON_OCR_USE_FROZEN=1` after rebuilding the onedir.
- Close OBS (or any other app) before selecting the same capture card in Bridge.

When Exact Calls is on and the DC critical situation fields auto-accept
(down/distance, field position, formation/personnel), top-3 Exact Calls appear
in the normal **Recommendations** panel (title **Exact Call**) — not inside the
OCR Fast Call strip. Confirm uses **Tap to Confirm** on those tiles. After
confirm:

- **Audible** and **Penalty** use the same desktop pickers as OC/DC (same
  formation/set audible shell; penalty stamps on the pending DC snap).
- Confirm feeds the DC snap pipeline so **Game State** can clear the sheet.
- Status text on the OCR strip names missing critical fields when a call is
  withheld.
- Ranking applies **cross-snap variety**: confirmed play IDs (−6.5) plus
  formation/set taxes from recent confirms and recently shown Exact Call
  sheets, so the same Nickel Cover 3 trio should not lock every snap.

When Exact Calls is off (or Tap & Speak sets the spot), Recommendations shows
**Package Call** as before. OC OCR syncs situation into the OC Recommendations
card the same way Speak does.

## Safe rollout

Enable in this order:

1. `OCR Capture` only. Collect at least 20 diagnostics samples. Required capture
   gate: stable/nonduplicate frames and p95 burst acquisition at or below 700 ms.
2. Shadow mode: compare recognized values and recommendations with Madden while
   continuing to use the existing DC v2 caller. Do not enable learning.
3. `Exact Calls` only after critical auto-accepted fields (**down/distance**,
   **field position**, **formation/personnel**) achieve at least 99% precision
   and 95% usable recall on the intended presentation profile. Previous-play
   ROIs are not part of that Exact Call gate.
4. `OCR Learning` only after at least 100 labeled snaps show correct prior-play
   attribution (when previous-play ROIs are drawn) and zero low-confidence
   learning events.

If any gate fails, leave the existing DC v2 workflow active. Do not reduce the
confidence threshold or substitute cloud OCR.

## Controls and recovery

- **Capture/recapture**: global shortcut or the Capture button.
- **Review**: correct unresolved fields before they can affect Exact Calls.
  Corrections re-parse down/distance, field position (`OWN 34` style), and
  formation/personnel (including I Form repair). Yard-only field text without
  OWN/OPP stays unaccepted — **except bare midfield `50`**, which is accepted as
  midfield so Exact Calls are not blocked at the 50.
- **Exact Call Confirm / Audible / Penalty**: confirm a generated defensive
  call from the Recommendations panel, then optionally correct the logged play
  or stamp a penalty (same pickers as the OC/DC boards).
- **Undo Last Snap**: appends an undo event and rebuilds learning.
- **Reset Opponent**: excludes that opponent's learned aggregates.
- **Export OCR Data**: exports profiles, event ledger, learning snapshot, and
  decision traces without raw frames. Use this for OCR field quality. For
  **top-3 recommendation** rotation analysis, open
  `%APPDATA%\gridiron-play-advisor-pc\trace-logs\gridiron-trace-current.txt`
  (`recommendation-trace` blocks) — the OCR JSON export does not include slates.
- **Delete OCR Data**: removes only the three versioned OCR files.

Live capture gate measured on this machine with the OBS plugin adapter:
3-frame bursts at 2560×1440, 20 samples, p50 ≈ 203 ms, p95 ≈ 204 ms (≤ 700 ms).
WebSocket PNG screenshot capture alone does **not** meet the gate.
Re-validate the same gate with **Capture Bridge** on card and PC-window sources
before treating Bridge as production-ready on a given machine.

## Rollback

The immediate rollback is to turn off all three OCR switches. The existing DC
v2 package caller then remains the only active path.

For a source-code rollback, remove `ocr/**`, `ocr-sidecar/**`, `capture-bridge/**`,
the OCR IPC registration in `main.js`/`preload.js`, OCR markup/styles, and the
package globs. Versioned OCR user data can remain inert or be removed with
**Delete OCR Data**. No current preferences, OC learning, or DC v2 state is
migrated or overwritten.

## Local verification

```powershell
cd PC
npm run test:ocr
npm run build:capture-bridge
npm run build:ocr-worker
$env:ALLOW_GPL_FFMPEG="true"
npm run dist
```

The final release gate requires a real Capture Bridge (or OBS legacy) + Xbox
session and an installed-app test. Source-only and synthetic fixture results do
not satisfy that gate.
