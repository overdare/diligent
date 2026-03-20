# CLAUDE.md

Diligent — transparent, debuggable coding agent. Bun + TypeScript strict, monorepo.

## Explore by Need

Read only what your task requires.

| Need | Start here |
|------|-----------|
| Project identity & principles | `README.md` |
| Architecture, layers & patterns | `ARCHITECTURE.md` |
| Source code — core engine (agent loop, providers, tool interfaces, auth primitives) | `packages/core/` |
| Source code — runtime (built-in tools, app-server, sessions, config, knowledge, skills, collab) | `packages/runtime/` |
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
- When implementing new features or modifying existing behavior, write or strengthen tests first whenever possible.
- Run tests after code changes
- Plan before implementing when a task involves multiple files or architectural changes
- When adding user-facing features, implement for both Web and TUI — they are thin clients of the same protocol (see `ARCHITECTURE.md` "Frontend Protocol Philosophy")
- Distinguish naming clearly: `Config` is for configuration values, while `Options` is for optional function arguments. Do not put runtime control arguments like `signal` into `Config`.

## Test File Convention

- Put all tests under each package-level `test/` directory only.
- Do not add tests under `src/**/__tests__/`.
- Mirror `src/` structure inside `test/`.
  - Example: `src/session/manager.ts` → `test/session/manager.test.ts`
- Use `*.test.ts` (or `*.test.tsx`) for unit tests.
- Use `*.integration.test.ts` (or `*.integration.test.tsx`) for integration tests.
- Keep shared test utilities in `test/helpers/` and static fixtures in `test/fixtures/`.
- For end-to-end scenarios, place tests in `packages/e2e/` only.
- For existing mixed layouts, prefer incremental migration to this convention when touching related files.

### Why this convention

- One obvious place for tests reduces decision overhead.
- Clear separation between runtime source (`src`) and verification code (`test`).
- Predictable paths improve review quality and refactoring safety.
- Simpler include/exclude patterns for tooling and CI.
