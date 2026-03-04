---
id: P025
status: backlog
created: 2026-03-04
---

# passion-junior GitHub Action

## Context

The tech-lead skill runs daily at 06:00 KST, producing a review with prioritized action items grouped by complexity. Group 1 items are simple, independent quick fixes (renaming, value replacements, constant extractions) that can be automated. The newly created `passion-junior` skill reads the latest review, parses Group 1 tasks, and executes each fix with an individual PR. This workflow automates that skill in CI.

## Implementation

### Create `.github/workflows/passion-junior.yml`

Pattern follows existing `tech-lead.yml` and `glob-indexer.yml` but with two key differences:
- **Creates PRs** instead of pushing directly to main
- **Claude handles git/gh operations** inside the skill (not in the workflow YAML)

```yaml
name: passion-junior

on:
  # Run 1 hour after tech-lead review (21:00 UTC = 06:00 KST → 22:00 UTC = 07:00 KST)
  schedule:
    - cron: '0 22 * * *'
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - run: bun install

      - name: Install Claude Code CLI
        run: npm install -g @anthropic-ai/claude-code

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - name: Run passion-junior skill
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: claude -p "/passion-junior" --model sonnet --dangerously-skip-permissions
```

Key design decisions:
- **Model: Sonnet** — Group 1 tasks are simple mechanical fixes; Opus is overkill, Haiku may lack reliability
- **Schedule: 22:00 UTC** — 1 hour after tech-lead to allow the review to be committed first
- **GITHUB_TOKEN** — Needed for `gh pr create` inside the skill; `secrets.GITHUB_TOKEN` is auto-provided
- **No post-step commit** — Unlike tech-lead/glob-indexer, passion-junior creates branches and PRs inside the skill itself, so no "Commit and push" step needed
- **`bun install`** — Needed for `bun run typecheck` which the skill runs to verify fixes

## Verification

1. Run `act -j run` locally or trigger `workflow_dispatch` manually from GitHub
2. Verify that for each Group 1 task:
   - A branch `fix/passion-junior/<slug>` was created
   - A PR was opened with the fix
   - `bun run typecheck` passes
3. Check that no Group 2/3 tasks were attempted

## Files

| Action | File |
|--------|------|
| Create | `.github/workflows/passion-junior.yml` |
