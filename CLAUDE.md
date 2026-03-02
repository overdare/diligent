# CLAUDE.md

Diligent — transparent, debuggable coding agent. Bun + TypeScript strict, monorepo.

## Navigate by Need

Read only what your task requires. Directories have README.md files — follow them recursively until you reach the file you need.

| Need | Start here |
|------|-----------|
| Project identity & principles | `README.md` |
| Architecture, layers & patterns | `ARCHITECTURE.md` |
| Current phase & progress | `STATUS.md` |
| Source code — core (agent loop, providers, tools, config, sessions) | `packages/core/` |
| Source code — cli (TUI) | `packages/cli/` |
| Source code — web (React + Tailwind web frontend) | `packages/web/` |
| Source code — debug-viewer (React web viewer) | `packages/debug-viewer/` |
| Source code — e2e (integration tests) | `packages/e2e/` |
| Planning, decisions & phase specs | `docs/plan/` |
| Reference codebases (codex, opencode, pi-mono) | `docs/references/` |
| Layer research & analysis | `docs/research/` |
| Past tech-lead assessments | `docs/review/` |
| Pending work items | `BACKLOG.md` |

TIP: Use `/glob-aug` skill to explore efficiently — shows directory trees with inline descriptions in one pass, avoiding glob+read loops.

```
# Example output from /glob-aug
$ /glob-aug "**/*.test.ts" packages/core/src
packages/core/src/
  skills/
    __tests__/
      discovery.test.ts    Tests for skill discovery and filesystem scanning
      frontmatter.test.ts  Tests for skill metadata frontmatter parsing and validation
      render.test.ts       Tests for skills section rendering with metadata
```

## Code Navigation System

Every source file and directory participates in a two-layer navigation index. **Maintain this when creating or modifying files.**

- **`@summary`** — first line of every source file: `// @summary <desc>` (or `# @summary` for .py). Skip index.ts, types.ts, config files.
- **`README.md`** — directories get a README when their recursive tree has 4+ nodes. Tree is built by expanding directories with 1–3 children inline and stopping at directories with 4+ children (flat list) or 0 children (leaf). Code block lists **subdirectories only** (no individual files).
- Use `/glob-indexer` skill to verify coverage.


## Rules

- English only in all files
- Clarify requirements fully before implementing — no assumptions
- Run tests after code changes

## Dev Commands

```
bun test / bun run lint / bun run lint:fix / bun run typecheck
```
