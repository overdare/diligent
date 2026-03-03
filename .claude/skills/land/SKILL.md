---
name: land
description: "Land worktree work onto local main — commit, rebase, and fast-forward merge. Use after finishing work in a worktree to merge everything back to main."
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

### Step 4 — Report

Summarize:
- Branch landed: `BRANCH`
- Commits landed (count)
- Note: "Worktree cleanup will happen on session exit."
