---
name: explore-aug
description: "Explore directories faster than glob+read loops — one command shows directory trees with inline @summary descriptions. Use when exploring the codebase, navigating unfamiliar directories, or needing a structural overview before diving in."
---

# explore-aug — Augmented Explore

```bash
node .claude/skills/explore-aug/explore.mjs <pattern> [path] [--depth N]
```

Shows directory structure with @summary extracted from first lines of files.

## Output example

```
packages/core/src/tools/
  bash.ts           Shell command execution with timeout and output truncation
  edit.ts           Surgical file editing via search-and-replace
  glob.ts           Find files by glob pattern via ripgrep
  grep.ts           Content search via ripgrep with regex support
  read.ts           Read file with binary detection and line numbers
  write.ts          Write file contents with directory auto-creation
```

## Patterns

```bash
# Subdirectories with README descriptions
node .claude/skills/explore-aug/explore.mjs "*/" packages/core/src

# Files with @summary
node .claude/skills/explore-aug/explore.mjs "*.ts" packages/core/src/tools

# Recursive directories with depth limit
node .claude/skills/explore-aug/explore.mjs "**/" packages/core/src --depth 2

# Brace expansion — multiple extensions at once
node .claude/skills/explore-aug/explore.mjs "*.{ts,tsx}" packages/cli/src

# Path segment — find files under a specific subtree
node .claude/skills/explore-aug/explore.mjs "src/**/*.ts" packages/core

# Recursive file search
node .claude/skills/explore-aug/explore.mjs "**/*.test.ts" packages/core
```
