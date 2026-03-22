---
name: passion-junior
description: >
  Auto-progress independently executable tasks from the latest tech-lead review and open individual PRs for each.
  Reads the most recent review in docs/review/, parses Priority Actions tasks across groups,
  then executes every task that can be progressed independently on a separate branch and opens a PR.
  Use this skill when: the user says "passion-junior", "auto-fix review items", "fix quick wins from review",
  "run the junior fixes", or asks to automatically resolve simple tech-lead review findings.
  Prefer proceeding without waiting whenever the repo context is sufficient; the user will judge via PR.
---

# Passion Junior

Execute all review tasks that can be progressed independently from repo context, each as an individual PR.

## Workflow

### 1. Find the latest review

Find the most recently committed review file using git:

```bash
git log --oneline --diff-filter=A -- 'docs/review/[0-9]*.md' | head -5
```

This lists commits that added files in that directory, newest first. The first result's file is the latest review. Multiple files may share the same date prefix, so filename sorting is unreliable — always use git commit order.

See [references/review-format.md](references/review-format.md) for format details.

### 2. Extract independently executable tasks

Parse the `## Priority Actions` section. Extract tasks from all groups and flat lists. Each task has:
- **Title**: bold text after the number
- **Files**: file paths with optional line numbers
- **Instruction**: what to change

Execute a task whenever it can be reasonably progressed from the review plus repository context alone.
Do not wait for user confirmation just because there are multiple plausible implementations; choose the best implementation that fits the review and repository context, then open a PR for the user to judge.
Only skip tasks when the repository context is insufficient to make a responsible change.

### 3. Check for existing PRs

Before executing any tasks, fetch the list of open passion-junior PRs:

```
gh pr list --label passion-junior --state open --json headRefName,title
```

Build a set of existing branch names from the result. In step 4, skip any task whose branch already exists in this set.

Also check if the review file being processed is the same one that existing PRs reference (by date in the review filename). If all independently executable tasks from that review already have open PRs, stop early and report "Nothing to do — all independently executable tasks already have open PRs."

### 4. Execute each task as a separate PR

For each independently executable task, sequentially:

1. Determine the branch name: `fix/passion-junior/<slug>` where slug is a kebab-case summary (e.g., `fix-pickfolder-rename`, `fix-p013-frontmatter`, `extract-oauth-token-url`)
2. **Skip if branch already exists** in the set from step 3 — log "Skipped (PR already open)" and continue to next task
3. Create branch from main
4. Read the target file(s) and apply the fix
5. Run `bun run typecheck` to verify no type errors introduced
6. Commit with message: `fix: <task title>` and body referencing the review
7. Push and open PR with:
   - Title: `fix: <task title>`
   - Body: reference to the review finding and what was changed
   - Label: `passion-junior` (create if missing)

### 5. Report results

After all tasks, output a summary table:

```
| # | Task | Branch | PR | Status |
|---|------|--------|----|--------|
| 1 | ... | fix/passion-junior/... | #N | created |
| 2 | ... | fix/passion-junior/... | — | skipped (PR already open) |
```

## Constraints

- Never modify code beyond what the review explicitly specifies
- If `bun run typecheck` fails after a fix, skip that task and report it as failed
- Do not combine multiple fixes into one PR
- Each branch must be based on the latest main
- If a task's target file has changed since the review (line numbers shifted), read the file and find the correct location by content matching
- Prefer the best implementation supported by the review and repository context, then let the user judge via PR
