# AGENTS.md

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

## Dev Commands

```
bun test / bun run lint / bun run lint:fix / bun run typecheck
```
