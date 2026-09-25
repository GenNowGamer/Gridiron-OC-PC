---
name: git-push
description: >-
  Push committed changes safely to the GitHub remote repository (https://github.com/GenNowGamer/Gridiron-OC-PC).
---

# Git Push Skill (/git-push)

Use this skill whenever the user invokes `/git-push` or asks to push local commits to GitHub.

## Objectives
1. Verify the current git branch and status of unpushed commits.
2. Confirm or configure the remote destination (`https://github.com/GenNowGamer/Gridiron-OC-PC.git`).
3. Safely push local commits to the target remote branch and report the result.

## Execution Procedure

### Step 1: Check Current Branch and Remotes
Run:
```powershell
git branch --show-current
git remote -v
```

### Step 2: Ensure Target Remote is Configured
Check if the remote pointing to `https://github.com/GenNowGamer/Gridiron-OC-PC.git` exists:
- If a remote for `Gridiron-OC-PC` already exists (e.g. `pc-origin` or `origin`), use it.
- If `origin` is pointing to the old or different repo (e.g. `Gridiron-OC-Mobile`), either set the correct URL or add a dedicated remote:
  ```powershell
  git remote add pc https://github.com/GenNowGamer/Gridiron-OC-PC.git
  ```
  *(or update `origin` if the user wants `origin` to be Gridiron-OC-PC)*.

### Step 3: Check Unpushed Commits
Review outgoing commits:
```powershell
git log @{u}..HEAD --oneline
```
(or compare against the remote branch).

### Step 4: Push to Remote
Push the current branch to GitHub:
```powershell
git push -u <remote-name> <current-branch>
```

### Step 5: Report Status
Confirm success, showing the branch name, remote URL, and pushed commit range to the user.
