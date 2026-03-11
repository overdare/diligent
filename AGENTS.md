# CLAUDE.md

Diligent — transparent, debuggable coding agent. Bun + TypeScript strict, monorepo.

## Explore by Need

Read only what your task requires.

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

## Code Explore System

Every source file has a `@summary` annotation on the first line: `// @summary <desc>` (or `# @summary` for .py). Skip index.ts, types.ts, config files.


## Rules

- English only in all files
- Clarify requirements fully before implementing — no assumptions
- Run tests after code changes
- Plan before implementing when a task involves multiple files or architectural changes
- After exiting plan mode, run `/tidy-plan` first before starting implementation
- When adding user-facing features, implement for both Web and TUI — they are thin clients of the same protocol (see `ARCHITECTURE.md` "Frontend Protocol Philosophy")