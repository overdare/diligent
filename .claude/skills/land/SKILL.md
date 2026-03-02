---
name: land
description: "Land worktree work onto local main — commit, rebase, fast-forward merge, and clean up the worktree. Use after finishing work in a worktree to merge everything back to main."
allowed-tools: Bash(git *), Skill(commit)
---

## Context

- Worktree list: !`git worktree list`
- Current branch: !`git branch --show-current`
- Git status: !`git status --short`
- Current directory: !`pwd`

## Your task

Land the current worktree's work onto local main. This is a **local-only** operation — no fetch, no push.

Follow these steps strictly in order. If any step fails, stop and report the error.

### Step 0 — Validate

From the context above, verify:

1. You are in a **worktree** (not the main working tree). Compare `pwd` against the first entry in `git worktree list` — if they match, abort: "Not in a worktree."
2. Current branch is **not** `main`. If it is, abort: "Already on main. Nothing to land."
3. Save these values for later steps:
   - `BRANCH` — current branch name
   - `WORKTREE_PATH` — current directory (the worktree path)
   - `MAIN_PATH` — first entry in `git worktree list` (the main working tree)

### Step 1 — Commit

If `git status --short` shows uncommitted changes, invoke the `/commit` skill. If the working tree is clean, skip this step.

### Step 2 — Rebase onto local main

```bash
git rebase main
```

If the rebase fails due to conflicts:
1. Run `git rebase --abort`
2. Report: "Rebase conflict. Resolve manually or squash your commits first."
3. **Stop.**

### Step 3 — Fast-forward merge

You cannot `git checkout main` inside a worktree because main is checked out in the main working tree. Update the ref directly:

```bash
git merge-base --is-ancestor main HEAD && git update-ref refs/heads/main HEAD
```

If `merge-base --is-ancestor` returns non-zero, report the error and stop.

### Step 4 — Clean up worktree

Remove the worktree. Run all git commands from `MAIN_PATH` via `-C` since the worktree directory will be deleted.

**Try in order — stop at first success:**

1. Normal remove:
   ```bash
   git -C "$MAIN_PATH" worktree remove "$WORKTREE_PATH"
   ```

2. If that fails, force remove:
   ```bash
   git -C "$MAIN_PATH" worktree remove --force "$WORKTREE_PATH"
   ```

3. If that also fails, manual cleanup:
   ```bash
   rm -rf "$WORKTREE_PATH"
   git -C "$MAIN_PATH" worktree prune
   ```

### Step 5 — Clean up branch

`git worktree remove` does **not** delete the branch. Delete it explicitly with safe delete:

```bash
git -C "$MAIN_PATH" branch -d "$BRANCH"
```

If `-d` fails, **ask the user** whether to force-delete with `-D`. This should not happen after a successful fast-forward — failure here means something unexpected occurred, so the user should decide.

### Step 6 — Report

Summarize:
- Branch landed: `BRANCH`
- Commits landed (count)
- Worktree removed: `WORKTREE_PATH`
- Branch deleted: `BRANCH`
- Note: "Session directory no longer exists. Start a new session or cd to the repo root."
