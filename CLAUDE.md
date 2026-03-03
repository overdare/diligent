# CLAUDE.md

Diligent — transparent, debuggable coding agent. Bun + TypeScript strict, monorepo.

## Explore by Need

Read only what your task requires. To explore a directory, read its EXPLORE.md for the directory tree, then drill into what you need.

| Need | Start here |
|------|-----------|
| Project identity & principles | `README.md` |
| Architecture, layers & patterns | `ARCHITECTURE.md` |
| Source code — core (agent loop, providers, tools, config, sessions) | `packages/core/` |
| Source code — cli (TUI) | `packages/cli/` |
| Source code — web (React + Tailwind web frontend) | `packages/web/` |
| Source code — desktop (Tauri v2 native app) | `apps/desktop/` |
| Source code — debug-viewer (React web viewer) | `packages/debug-viewer/` |
| Source code — e2e (integration tests) | `packages/e2e/` |
| Planning, decisions & phase specs | `docs/plan/` |
| Reference codebases (codex, opencode, pi-mono) | `docs/references/` |
| Layer research & analysis | `docs/research/` |
| Past tech-lead assessments | `docs/review/` |
| Pending work items | `BACKLOG.md` |

TIP: Use `/explore-aug` skill to explore efficiently — shows directory trees with inline descriptions in one pass, avoiding glob+read loops.

```
# Example output from /explore-aug
$ /explore-aug "**/*.test.ts" packages/core/src
packages/core/src/
  skills/
    __tests__/
      discovery.test.ts    Tests for skill discovery and filesystem scanning
      frontmatter.test.ts  Tests for skill metadata frontmatter parsing and validation
      render.test.ts       Tests for skills section rendering with metadata
```

## Code Explore System

Every source file and directory participates in a two-layer explore index. **Maintain this when creating or modifying files.**

- **`@summary`** — first line of every source file: `// @summary <desc>` (or `# @summary` for .py). Skip index.ts, types.ts, config files.
- **`EXPLORE.md`** — directories with 4+ nodes get an EXPLORE.md containing only the directory tree code block (subdirectories only, no individual files). Tree is built by expanding directories with 1–3 children inline and stopping at directories with 4+ children (flat list) or 0 children (leaf). README.md links to it with `For directory structure, see [EXPLORE.md](EXPLORE.md).`
- Use `/explore-indexer` skill to verify coverage.


## Rules

- English only in all files
- Clarify requirements fully before implementing — no assumptions
- Run tests after code changes
- Plan before implementing when a task involves multiple files or architectural changes
- After exiting plan mode, run `/tidy-plan` first before starting implementation
- When adding user-facing features, implement for both Web and TUI — they are thin clients of the same protocol (see `ARCHITECTURE.md` "Frontend Protocol Philosophy")