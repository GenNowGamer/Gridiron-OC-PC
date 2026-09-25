---
name: update-docs
description: >-
  Update all workspace documentation (README.md, OCR_DC_GUIDE.md, release checklists, session notes)
  to stay in sync with recent codebase, architecture, test, and config changes.
---

# Update Docs Skill (/update-docs)

Use this skill whenever the user invokes `/update-docs` or asks to update workspace documentation.

## Objectives
1. Audit all recent code, configuration, test, and script changes in the workspace.
2. Synchronize project documentation so that setup instructions, architecture descriptions, feature flags, version numbers, and validation steps reflect current code.
3. Ensure documentation integrity (preserve existing accurate sections while updating stale details).

## Target Documentation Files
- `README.md` (Main project guide, architecture, installation, test scripts, feature overview)
- `OCR_DC_GUIDE.md` (DC assistant workflow, OCR capture pipeline, hotkeys, confidence thresholds)
- `OCR_RELEASE_VALIDATION_CHECKLIST.md` (Pre-release testing requirements, packaging, sidecar builds)
- Any session or architectural summaries (e.g. `SESSION_REVIEW_*.md`, `VALIDATION_*.md`) if relevant

## Execution Procedure

### Step 1: Discover Recent Modifications
Run `git status` and `git diff --stat` (or check recent git commits) to identify which components changed:
- Electron core (`main.js`, `preload.js`, `app.js`, `styles.css`)
- OCR pipeline (`ocr/main/`, `ocr/renderer/`, `ocr/shared/`, `ocr-sidecar/`)
- Test suites (`scripts/test-app-regressions.cjs`, `ocr/main/test/`, `scripts/smoke-*.mjs`)
- Dependencies & build scripts (`package.json`, `launch_pc_app.bat`, `build.ps1`)

### Step 2: Cross-Check Features & Flags
- Verify `package.json` scripts and version numbers match what is documented.
- Check configuration defaults in `ocr/main/config-store.js` or `app.js` (e.g., capture hotkeys, telemetry flags, learning rates, confidence thresholds).
- Verify test commands documented in `README.md` (`npm run verify:pc`, `npm run test:regression`, `npm run test:ocr:js`, etc.) are exact and current.

### Step 3: Update Document Files
- Apply precise updates to each affected document using file replacement tools.
- Keep formatting clean, using standard markdown headings, tables, and fenced code blocks.

### Step 4: Verification
- Verify that documentation contains no broken links, obsolete flags, or outdated command names.
- Report a concise summary of the updated documentation to the user.
