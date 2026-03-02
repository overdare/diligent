---
name: glob-indexer
description: "Maintain @summary annotations and README.md navigation. Use when user says 'update navigation', 'check README', 'add summary', 'fix index', 'coverage', or after directories are added/moved/reorganized."
---

# glob-indexer — Codebase Index Maintenance

## Check

```bash
node .claude/skills/glob-indexer/check.mjs [path]
```

Reports missing/stale README.md and per-directory @summary coverage.

## Auto-fix flow

When invoked, run `check.mjs` and fix all issues automatically:

1. Run `check.mjs` → collect missing README, stale README, and low-coverage directories
2. If there are issues, spawn **one Agent call** (model: haiku) per problem category:
   - **Missing/stale README.md** — Agent reads directory contents and writes README.md (heading + one-line desc + code block listing subdirectories only)
   - **Missing @summary** — Agent reads each file and prepends `// @summary <desc>` as first line
3. Run `check.mjs` again to verify 100%
4. Report results to user

### Agent prompt template for @summary batch

```
Add `// @summary <description>` as the FIRST line of each source file
that doesn't already have one in these directories:
<list directories and files from check output>

Rules:
- Read each file, then use Edit tool to prepend `// @summary <one-line description>`
- For .py files use `# @summary <desc>`
- Skip files that already have @summary
- Summary should be concise and describe what the file does
```

## Conventions

- `@summary`: first-line annotation (`// @summary <desc>`). Skip index/types/config files.
- `README.md`: `# Heading`, one-line description, code block with **subdirectories only** (no files).
  - **4+ subdirs** → need README, list subdirs flat.
  - **< 4 subdirs but any child has 4+ subdirs** → need README with **2-depth listing** (expand that child's subdirs inline, indented).
  - 2-depth example:
    ```
    src/
      agent/             Agent loop and execution
      config/            Configuration management
      provider/          LLM providers
      ...
    test/                Unit tests
    ```
