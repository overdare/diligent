# CLAUDE.md

Diligent — transparent, debuggable coding agent. Bun + TypeScript strict, monorepo.

## Navigate by Need

Read only what your task requires. Directories have README.md files — follow them recursively until you reach the file you need.
Use `/glob-aug` to explore efficiently — shows directory trees with inline `@summary` descriptions in one pass, avoiding glob+read loops.

| Need | Start here |
|------|-----------|
| Project identity & principles | `README.md` |
| Architecture, layers & patterns | `ARCHITECTURE.md` |
| Current phase & progress | `STATUS.md` |
| Source code — core (agent loop, providers, tools, config, sessions) | `packages/core/` |
| Source code — cli (TUI) | `packages/cli/` |
| Source code — debug-viewer (React web viewer) | `packages/debug-viewer/` |
| Source code — e2e (integration tests) | `packages/e2e/` |
| Planning, decisions & phase specs | `docs/plan/` |
| Reference codebases (codex, opencode, pi-mono) | `docs/references/` |
| Layer research & analysis | `docs/research/` |
| Past tech-lead assessments | `docs/review/` |
| Pending work items | `BACKLOG.md` |

## Rules

- English only in all files
- Clarify requirements fully before implementing — no assumptions
- Run tests after code changes

## Code Navigation System

Every source file and directory participates in a two-layer navigation index. **Maintain this when creating or modifying files.**

- **`@summary`** — first line of every source file: `// @summary <desc>` (or `# @summary` for .py). Skip index.ts, types.ts, config files.
- **`README.md`** — directories with 4+ subdirectories get a README: `# Heading`, one-line description, code block listing **subdirectories only** (no individual files).
- Run `node .claude/skills/glob-indexer/check.mjs` to verify coverage.

## Dev Commands

```
bun test / bun run lint / bun run lint:fix / bun run typecheck
```
