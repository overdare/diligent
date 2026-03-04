# Tech-Lead Review Format Reference

## Review File Location

Reviews are stored in `docs/review/tech-lead/` with naming convention:
`YYYY-MM-DD-<short-commit-hash>.md` (optionally with scope suffix like `-web`).

## Finding the Latest Review

Sort review files by date prefix descending. The most recent file is the latest review.

## Priority Actions Section

The "## Priority Actions" section appears near the end of each review.

### Format Variant A: Grouped (latest format, 2026-03-04+)

```markdown
## Priority Actions

### Group 1 (parallel — independent quick fixes)

1. **<Title>** — <description>.
   - File: `<path>:<line>` — <instruction>

2. **<Title>** — <description>.
   - File: `<path>` — <instruction>

### Group 2 (parallel — moderate effort, independent)
...

### Group 3 (parallel, after Group 2 — design decisions needed)
...
```

### Format Variant B: Flat numbered list (older reviews)

```markdown
## Priority Actions

1. **<Title>** — <description>
   Files: `<path1>`, `<path2>`

2. **<Title>** — <description>
   - File: `<path>` — <instruction>
```

## Identifying Group 1 Tasks

Group 1 tasks are characterized by:
- Labeled "parallel — independent quick fixes" or similar
- Each task is self-contained (no dependencies on other tasks)
- Typically involve: renaming, value replacement, constant extraction, frontmatter fixes
- Fix cost described as "1 minute" or "15 minutes"
- Each task specifies exact file path(s) and what to change

When variant B is used, look for tasks explicitly described as "quick", "cosmetic", "1-minute fix", or similar low-effort indicators.
