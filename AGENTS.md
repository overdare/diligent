# AGENTS.md

Diligent — transparent, debuggable coding agent. Bun + TypeScript strict, monorepo.

## Explore by Need

Read only what your task requires.

| Need | Start here |
|------|-----------|
| Project identity & principles | `README.md` |
| Architecture, layers & patterns | `ARCHITECTURE.md` |
| Source code — core engine (agent loop, providers, tool interfaces, auth primitives) | `packages/core/` |
| Source code — runtime (built-in tools, app-server, sessions, config, memory, skills, collab) | `packages/runtime/` |
| Source code — shared protocol contract | `packages/protocol/` |
| Source code — plugin SDK for external tool packages | `packages/plugin-sdk/` |
| Source code — cli (TUI) | `packages/cli/` |
| Source code — debug-viewer (React web viewer) | `packages/debug-viewer/` |
| Source code — end-to-end suites | `packages/e2e/` |
| Product and usage guides | `docs/guide/` |

## Code Explore System

Many source files start with a `@summary` annotation. Use it as a routing hint when present; inspect public entrypoints, types, and configuration when they are relevant to the task.

## Documentation Routing

- Start with `ARCHITECTURE.md` for cross-package invariants, ownership boundaries, and shared frontend/backend rules.
- Use `docs/guide/*` for feature-specific behavior, examples, and change procedures.
- Do not infer shared architecture from a single client or package implementation alone.


## Rules

- English only in all files
- Diligent is an independent framework, separate from the products and organization that develop and maintain it. Keep project content and design product- and company-neutral.
- Do not mention the maintaining organization or other companies in documentation, commit messages, pull requests, issues, or other project records.
- Do not spawn more than one subagent for a task.
- Resolve discoverable facts from the repository. Ask when missing information would materially change scope, behavior, or authority; make routine implementation choices yourself.
- When implementing new features or modifying existing behavior, write or strengthen tests first whenever possible.
- Run relevant tests and required checks after behavior changes. Repeat or broaden passing checks only for new changes, failures, or unresolved concerns.
- Plan work that changes architecture, ownership boundaries, or has meaningful dependencies; scale the plan to the task.
- When creating or renaming branches, follow the repository's existing Git branch naming convention (for example `fix/...`, `feat/...`, `docs/...`). Repository branch rules override generic agent defaults: do not create agent-prefixed branches such as `codex/...` unless the user explicitly requests that exact prefix.
- User-facing Diligent features are implemented through the shared protocol. Keep the protocol client-neutral and update the clients in this repository (see `ARCHITECTURE.md` "Frontend Protocol Philosophy").
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

### Test Layer Routing

- Put a scenario in `packages/e2e/app-server/` when it drives `DiligentAppServer` through public JSON-RPC and proves
  only client-observable behavior: a response, notification, persisted state, or external effect.
- An in-memory `RpcPeer` still exercises the app-server's real transport-neutral boundary. Stdio/NDJSON, WebSocket,
  CLI child-process startup, and Web host startup belong to their owning host or transport suite.
- Keep a test under `packages/runtime/test/app-server/` when it calls a handler or helper directly, inspects internal
  state, verifies collaborator calls, or names an implementation detail such as a cache, map, serializer, or injected
  default.
- As a practical check: a test that should pass for any implementation of the same JSON-RPC contract belongs in e2e;
  a test that must change after an internal refactor belongs with the package implementation.
- App-server e2e tests should import public package surfaces rather than `packages/*/src/**`. When touching legacy mixed
  tests, migrate protocol-observable scenarios incrementally instead of adding more mixed coverage.

### Test Design

- Test observable behavior and stable contracts. Assertions must catch a plausible incorrect implementation of the named behavior, including relevant side effects or ordering.
- Exercise production code. Avoid fixture-only roundtrips, dependency self-tests, and smoke checks unless completion or liveness is the contract or an integration boundary otherwise cannot be observed.
- Use regression tests to reproduce bugs and verify fixes. Retain them only when they serve as a valuable specification or guard particularly error-prone behavior; otherwise delete them after verifying the fix. Keep retained tests aligned with the current contract and consolidate duplicate coverage.
- Prompt tests verify assembly, propagation, filtering, and injected data. Fixed wording and scripted model responses do not establish model behavior; use behavioral evals to assess that.
- Derive configuration-driven expectations from the configuration under test. Use synthetic fixtures for generic capability and policy logic; avoid copying current defaults, model/provider catalogs, counts, or feature-flag values.
- Assert exact values or wording only for explicit compatibility, protocol, transformation, or regression contracts. Name the contract being protected, and allow implementation changes that preserve it.
