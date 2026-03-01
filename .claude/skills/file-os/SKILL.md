---
name: file-os
description: "Explore codebase structure with summaries, maintain README.md navigation, and manage @summary annotations. Use when the user says 'explore', 'navigate', 'update navigation', 'fix README', 'add breadcrumb', 'add summary', 'nav 업데이트', 'README 정리', or when directories have been added, moved, or reorganized."
---

# File OS — Codebase Navigation with Summaries

Two conventions let scripts produce structured codebase overviews that replace expensive glob→read loops.

## Convention: @summary

A one-line summary embedded in the file's first line:

```typescript
// @summary Agent loop orchestrator — runs turns, dispatches tool calls
import { z } from "zod";
```

- Must be the **first line** of the file
- Format: `// @summary <description>` (or `# @summary` for py/sh, `-- @summary` for sql, `<!-- @summary -->` for html/md)
- Optional — not every file needs one. Skip index/types/config files.

## Convention: README.md

Directory README.md files list **subdirectories** (and key files) with brief descriptions in code blocks:

```markdown
# Core

Agent loop, providers, tools, config, sessions, and knowledge.

\```
src/
  agent/           Agent loop and loop detector
  config/          Config loading, schema, instructions
\```
```

## Scripts

### explore — Directory structure + summaries

```bash
node .claude/skills/file-os/explore.mjs <pattern> [path] [--depth N]
```

| Arg | Description | Default |
|-----|-------------|---------|
| `pattern` | Glob pattern (`*/`, `*.ts`, `**/`) | Required |
| `path` | Search root directory | cwd |
| `--depth N` | Limit tree depth | Unlimited |

Files are always shown with @summary when available.

**Examples:**

```bash
# Direct subdirectories of core/src with descriptions
node .claude/skills/file-os/explore.mjs "*/" packages/core/src

# .ts files in a specific directory
node .claude/skills/file-os/explore.mjs "*.ts" packages/core/src/tools

# Recursive with depth limit
node .claude/skills/file-os/explore.mjs "**/" packages/core/src --depth 2

# Cross-package exploration
node .claude/skills/file-os/explore.mjs "*/" packages/*/src
```

### check — README.md gaps and @summary coverage

```bash
node .claude/skills/file-os/check.mjs [path]
```

Reports:
- **Missing README.md** — directories with 2+ subdirectories but no README
- **Stale README.md** — listed directories don't match actual contents
- **@summary coverage** — per-directory file coverage, sorted worst-first

## Operations (LLM performs these)

### readme — Create/update README.md files

1. Run `node .claude/skills/file-os/check.mjs` → identify gaps
2. For each missing/stale directory, run `node .claude/skills/file-os/explore.mjs "*/" <dir>` → understand structure
3. Write README.md following the convention (# heading, one-line description, code block with entries)
4. Use the Agent tool to process multiple directories in parallel

### add-summary — Batch @summary insertion

1. Run `node .claude/skills/file-os/check.mjs` → find low-coverage directories
2. Read files that need summaries
3. Use the Agent tool with `model: "haiku"` to generate summaries (cost-efficient)
4. Insert `// @summary <text>` as the first line of each file
5. Confirm with user before applying

### audit — Full navigation check

1. Run `node .claude/skills/file-os/check.mjs` for the full report
2. Verify CLAUDE.md navigation table paths exist
3. Report findings and suggest fixes

## Conventions

- README.md uses **code blocks** (not tables) for directory listings
- Descriptions are terse: enough to decide whether to read further
- Skip generated files, node_modules, .gitignore, etc. in listings
- When a directory moves, update both the README.md chain and any .md files referencing the old path
- Use the Agent tool to parallelize multi-directory operations
