---
name: git-commit
description: >-
  Inspect workspace git status, exclude transient build artifacts, stage changes made
  in the current chat session, and commit them with a structured, descriptive commit message.
---

# Git Commit Skill (/git-commit)

Use this skill whenever the user invokes `/git-commit` or asks to commit changes made during the session.

## Objectives
1. Inspect git status and diff across the workspace to determine all modified, deleted, and newly added files.
2. Filter out transient files, temporary build logs, local cache directories, or unneeded binary outputs.
3. Formulate a structured conventional commit message that accurately details what was added, fixed, or updated during the session.
4. Stage relevant files and create the git commit.

## Execution Procedure

### Step 1: Check Working Tree Status
Run:
```powershell
git status --short
```
And check diff statistics:
```powershell
git diff --stat
```

### Step 2: Filter Transient Files
Do NOT stage or commit:
- PyInstaller / build logs (e.g., `*.log`, `pyinstaller-last-build.log`)
- Temporary cache files (`.cache/`, `.pytest_cache/`, `node_modules/`, `dist/`)
- Raw temporary image dumps or test captures unless explicitly requested by the user

If necessary, append newly identified transient patterns to `.gitignore`.

### Step 3: Stage Files
Stage only intentional changes and new features:
```powershell
git add <specific files or folders>
```

### Step 4: Compose Descriptive Commit Message
Follow conventional commit format:
- `feat(pc): ...` for new features or capabilities
- `fix(ocr): ...` for OCR bug fixes, fuzzy corrections, or score/down-distance calibrations
- `fix(pc): ...` for recommendation logic, UI, or state transitions
- `docs: ...` for documentation updates
- `test: ...` for regression and unit test suite updates

Include bullet points in the commit body summarizing the notable changes.

### Step 5: Execute Commit and Report
Execute `git commit -m "..."` and present the resulting commit hash, branch, and staged file summary to the user.
