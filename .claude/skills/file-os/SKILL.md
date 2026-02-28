---
name: file-os
description: "Maintain the project's breadcrumb navigation system — the chain of CLAUDE.md → directory README.md files that lets Claude find what it needs by following links recursively. Use this skill when the user says 'update navigation', 'fix README', 'add breadcrumb', 'nav 업데이트', 'README 정리', or when directories have been added, moved, or reorganized and their README.md guides need to catch up. Also trigger when the user asks to audit or review the navigation structure."
---

# File OS — Breadcrumb Navigation Maintenance

This project uses a recursive navigation system so Claude reads only what a task requires, instead of loading everything upfront. Your job is to keep this system accurate and connected.

## How the System Works

```
CLAUDE.md (root compass — always loaded)
  → "Navigate by Need" table points to directories and key files
    → Each directory has a README.md listing its contents
      → Subdirectories have their own README.md, and so on
```

Claude follows this chain: CLAUDE.md → directory README.md → deeper README.md → target file. If any link in the chain is missing or stale, Claude either reads too much or can't find what it needs.

## The Two Layers

**CLAUDE.md** — the root. A table mapping needs to starting points. Also carries a one-line project description, rules, and dev commands. This file is always in context, so keep it minimal.

```
| Need | Start here |
|------|-----------|
| Architecture, layers & patterns | `ARCHITECTURE.md` |
| Planning, decisions & phase specs | `docs/plan/` |
```

**Directory README.md** — a signpost. One-line description of the directory's purpose, then a code block listing contents with brief annotations. No tables, no file-level summaries — just structure.

```
# Planning

Design decisions, phase roadmap, and implementation specs.

\```
decisions.md                 Design decisions log (D001–D087+)
implementation-phases.md     Phase roadmap and phase-layer matrix
impl/                        Per-phase implementation specs
\```
```

## Operations

### Audit

Scan for gaps and staleness:

1. Read CLAUDE.md — check every path in the navigation table actually exists
2. List directories referenced in the table — check each has a README.md
3. For each README.md, compare its listed contents against the actual directory (`ls`)
4. Report: missing README.md files, stale entries (listed but deleted), unlisted entries (exist but not listed)

### Create README.md for a New Directory

1. `ls` the directory to see what's in it
2. Write a README.md following the format:
   - `# Title` — what this directory is about (one line)
   - Blank line, then one sentence of context if needed
   - Code block listing contents with brief descriptions
3. If this is a new top-level entry, add a row to CLAUDE.md's navigation table

### Update After Changes

When files or directories have been added, moved, or deleted:

1. Identify which README.md files are affected (the directory itself and its parent)
2. Update each one to reflect the current contents
3. If a directory was moved, grep for old paths in all .md files and update them
4. If a top-level entry changed, update CLAUDE.md's table

### Path Reference Update

When a directory is moved (like `docs/research/references/` → `docs/references/`):

1. `grep -r` the old path across all .md files (including .claude/skills/)
2. Update every reference
3. Verify with a final grep that zero references remain

## When to Add a README.md

Only where a directory **branches** — where there are multiple siblings and an LLM wouldn't know which to pick without a guide. A linear chain like `a/b/c/d/e` with one item at each level needs no intermediate README.md files. The goal is minimal navigation, not exhaustive documentation.

## Parallelism

When multiple directories need README.md creation or updates, use the Agent tool to process them in parallel — one subagent per directory. Each subagent scans (`ls`) its assigned directory, writes or updates the README.md, and returns the result. This avoids sequential round-trips and keeps the main context clean.

## Conventions

- README.md lists folders and files that matter for navigation — skip generated files, node_modules, .gitignore, etc.
- Descriptions are terse: enough to decide whether to read further, no more
- Use code blocks (not tables) for directory listings in README.md files
- CLAUDE.md is the only place that uses a markdown table (the navigation table)
- When a directory moves, always update both the README.md chain and any .md files that reference the old path
