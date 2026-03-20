---
name: passion-junior
description: >
  Auto-fix executable tasks from the latest tech-lead review and open individual PRs for each.
  Reads the most recent review in docs/review/, parses Priority Actions tasks across groups,
  then executes every task that can be completed without user judgment on a separate branch and opens a PR.
  Use this skill when: the user says "passion-junior", "auto-fix review items", "fix quick wins from review",
  "run the junior fixes", or asks to automatically resolve simple tech-lead review findings.
  Do NOT execute tasks requiring user/product/design judgment.
---

# Passion Junior

Execute all review tasks that are actionable without user judgment, each as an individual PR.

## Workflow

### 1. Find the latest review

Find the most recently committed review file using git:

```bash
git log --oneline --diff-filter=A -- 'docs/review/[0-9]*.md' | head -5
```

This lists commits that added files in that directory, newest first. The first result's file is the latest review. Multiple files may share the same date prefix, so filename sorting is unreliable — always use git commit order.

See [references/review-format.md](references/review-format.md) for format details.

### 2. Extract executable tasks

Parse the `## Priority Actions` section. Extract tasks from all groups and flat lists. Each task has:
- **Title**: bold text after the number
- **Files**: file paths with optional line numbers
- **Instruction**: what to change

Skip any task that:
- Requires creating new types or schemas
- Involves more than 3 files
- Is described as needing design decisions
- Requires product direction, prioritization, or any user choice
- Has ambiguous acceptance criteria that cannot be resolved from repo context

### 3. Check for existing PRs

Before executing any tasks, fetch the list of open passion-junior PRs:

```
gh pr list --label passion-junior --state open --json headRefName,title
```

Build a set of existing branch names from the result. In step 4, skip any task whose branch already exists in this set.

Also check if the review file being processed is the same one that existing PRs reference (by date in the review filename). If all executable tasks from that review already have open PRs, stop early and report "Nothing to do — all executable tasks already have open PRs."

### 4. Execute each task as a separate PR

For each executable task, sequentially:

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
