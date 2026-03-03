---
name: explore-indexer
description: "Maintain @summary annotations and EXPLORE.md navigation indexes. Use when after directories are added/moved/reorganized."
---

# explore-indexer — Codebase Index Maintenance

## Check

```bash
node .claude/skills/explore-indexer/check.mjs [path]
```

Reports missing/stale EXPLORE.md and per-directory @summary coverage.

## Auto-fix flow

When invoked, run `check.mjs` and fix all issues automatically:

1. Run `check.mjs` → collect missing EXPLORE.md, stale EXPLORE.md, and low-coverage directories
2. If there are issues, spawn **one Agent call** (model: haiku) per problem category:
   - **Missing EXPLORE.md** — Agent creates EXPLORE.md (just the directory tree code block) and adds pointer line to README.md
   - **Stale EXPLORE.md** — Agent reads existing EXPLORE.md and replaces the code block with the updated tree
   - **Missing @summary** — Agent reads each file and prepends `// @summary <desc>` as first line
3. Run `check.mjs` again to verify 100%
4. Report results to user

### Agent prompt template for missing EXPLORE.md

```
Create EXPLORE.md for these directories (no EXPLORE.md exists yet):
<list directories from check output>

For each directory:
1. Create EXPLORE.md containing only a code block with the directory tree:
\```
<directory tree — subdirectories only, no individual files>
\```

2. If README.md exists, add this line after the first paragraph (heading + one-liner):
   For directory structure, see [EXPLORE.md](EXPLORE.md).
   If README.md does not exist, create a minimal one:
   # <directory name>

   <one-line description>

   For directory structure, see [EXPLORE.md](EXPLORE.md).

Rules:
- EXPLORE.md contains ONLY the code block — no headings, no prose
- Use the exact tree format from check.mjs output
- Only list subdirectories (no files) in the code block
```

### Agent prompt template for stale EXPLORE.md

```
Update the directory tree in these EXPLORE.md files (directory contents changed):
<list directories and their expected trees from check output>

For each EXPLORE.md:
1. Read the existing file
2. Replace the entire code block content with the updated directory tree
3. Do NOT touch any README.md files

Rules:
- Only the code block content changes
- Use the exact tree from check.mjs --plan output for that directory
```

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
- `EXPLORE.md`: contains only a directory tree code block with **subdirectories only** (no files).
  - **Recursive expansion rule**: build tree by recursing until a directory has 4+ children (fan-out stop) or 0 children (leaf). Directories with 1–3 children are expanded inline.
  - **Need EXPLORE.md** if tree has 4+ total nodes.
  - `README.md` links to it with: `For directory structure, see [EXPLORE.md](EXPLORE.md).`
  - 3-depth example (`packages/cli/EXPLORE.md`):
    ```
    src/
      tui/
        __tests__/       Unit tests
        commands/        CLI commands
        components/      UI components
        framework/       TUI framework core
        tools/           Tool integrations
    test/                Integration tests
    ```
