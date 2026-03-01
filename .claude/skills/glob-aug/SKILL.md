---
name: glob-aug
description: "Faster than glob+read loops — one command shows directory trees with inline @summary descriptions. Use before diving into unfamiliar directories or when you need a structural overview."
---

# glob-aug — Augmented Glob

```bash
node .claude/skills/glob-aug/explore.mjs <pattern> [path] [--depth N]
```

Shows directory structure with @summary extracted from first lines of files.

```bash
# Subdirectories
node .claude/skills/glob-aug/explore.mjs "*/" packages/core/src

# Files with summaries
node .claude/skills/glob-aug/explore.mjs "*.ts" packages/core/src/tools

# Recursive
node .claude/skills/glob-aug/explore.mjs "**/" packages/core/src --depth 2
```
