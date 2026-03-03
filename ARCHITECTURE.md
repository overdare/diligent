# Architecture

Diligent is a transparent, debuggable coding agent built with Bun + TypeScript (strict mode).

## Runtime & Stack

- **Runtime**: Bun (fast startup, native TS, Bun.spawn, Bun test runner)
- **Language**: TypeScript in strict mode
- **Monorepo**: Bun workspaces
- **External dependency**: ripgrep (`rg`) required for glob and grep tools (D022)

## Packages

| Package | Purpose |
|---|---|
| `packages/core` | Agent loop, provider abstraction, tool system, tools, auth, sessions (the engine) |
| `packages/protocol` | Shared Zod schemas for JSON-RPC messages, events, and domain models |
| `packages/cli` | CLI entry point, TUI rendering, user interaction |
| `packages/web` | React + Tailwind web frontend with WebSocket transport |
| `apps/desktop` | Tauri v2 desktop app wrapping `@diligent/web` with Bun sidecar |
| `packages/debug-viewer` | Standalone web UI for inspecting `.diligent/` session data |
| `packages/e2e` | End-to-end tests against the full agent |

## Layer Architecture (11 layers, L0-L10)

Each layer is a functional subsystem. Layers are progressively deepened across implementation phases.

| Layer | Name | Status | Key Decisions |
|---|---|---|---|
| L0 | Provider | 4 providers (Anthropic, OpenAI, ChatGPT OAuth, Gemini) + ProviderManager | D001, D003, D009, D010 |
| L1 | Agent Loop | Full events, compaction, mode filtering, loop detection, steering | D004, D007, D008, D087 |
| L2 | Tool System | Truncation, progress, approval hook stub | D013, D014, D015, D025 |
| L3 | Core Tools | 11 tools (bash, read, write, edit, glob, grep, ls, plan, task, add_knowledge, request_user_input) | D017-D024, D082, D088 |
| L4 | Approval | Stub (auto-approve, future) | D027-D031 |
| L5 | Config | 3-layer JSONC + knowledge/compaction wired | D032-D035 |
| L6 | Session | Persistent + compaction + knowledge + steering + session list/switch/delete | D036-REV, D037-D043, D080-D084 |
| L7 | TUI & Commands | Component framework + overlay + slash commands + collaboration modes | D045-D051, D087 |
| L8 | Skills | Discovery, frontmatter, system prompt injection | D052-D053 |
| L9 | MCP | Planned | D056-D061 |
| L10 | Multi-Agent | Done (task tool, agent types, permission isolation, result format) | D062-D065 |

Deep research per layer: `docs/research/layers/NN-*.md`

## Frontend Protocol Philosophy

Inspired by codex-rs's architecture: **one protocol, multiple transports**.

`DiligentAppServer` is the single source of truth for agent logic. All frontends — TUI, Web, Desktop — are thin protocol clients that differ only in transport and rendering.

```
TUI                       Web                       Desktop
 │                         │                         │
 │  in-process JSON-RPC    │  WebSocket JSON-RPC     │  Tauri + Bun sidecar
 │  (LocalAppServerRpcClient)  (RpcBridge → ws://)   │  (same WebSocket as Web)
 └────────────┬────────────┴────────────┬────────────┘
              │                         │
    DiligentAppServer  (@diligent/core)
    ProviderManager, SessionManager, AgentLoop, Tools
```

**Rules that follow from this:**

1. **Web server = simple runner.** `packages/web/src/server` does exactly three things: start `DiligentAppServer`, open a WebSocket endpoint, serve static files. No agent logic, no custom auth flow, no provider management lives here.

2. **All flows are shared.** Provider management, auth, model resolution, system prompt construction, session lifecycle, tool building — every agent logic flow is identical for TUI and Web. This code lives in `packages/core`. When adding or changing a flow, implement it once in core and wire it through both frontends together.

3. **Protocol is the boundary.** `@diligent/protocol` defines every message that crosses the frontend/backend boundary. TUI's `LocalAppServerRpcClient` and Web's `RpcBridge` are both implementations of the same protocol — not separate systems.

4. **No frontend differentiation in the server.** If logic is only needed by Web (e.g. serving static assets), it belongs in the transport layer. If logic belongs to the agent (e.g. model selection, auth), it belongs in core.

5. **Desktop = Web in a native shell.** `apps/desktop` uses Tauri v2 with a Bun sidecar. The Tauri frontend loads the same React app; the sidecar runs the same web server. No desktop-specific agent logic.

## Key Design Patterns

- **EventStream** (D007): Custom async iterable for streaming LLM responses and agent events. Producer pushes events, consumer uses `for await`, completion via `.result()` promise. ~86 lines.
- **AgentEvent union** (D004): 20 tagged-union event types covering lifecycle, turns, message streaming, tool execution, status, usage, errors, compaction, knowledge, loop detection, and steering. `MessageDelta` type prevents provider events leaking into L1.
- **Tool interface** (D013): `{ name, description, parameters (Zod schema), execute(args, ctx) }`. One file per tool in `packages/core/src/tools/`.
- **TurnContext** (D008): Immutable per-turn config (model, tools, policies) separated from mutable session state. Agent loop is a pure stateless function.
- **Provider abstraction** (D003): Common `StreamFunction` interface. `ProviderManager` dispatches to Anthropic, OpenAI (Responses API), ChatGPT (OAuth), Gemini based on model prefix. Model registry with alias resolution. API key and OAuth token lifecycle managed centrally via auth-store.
- **Session persistence** (D006/D036-REV): JSONL append-only files with tree structure (id/parentId). Project-local at `.diligent/sessions/`. SESSION_VERSION 4 with CompactionEntry, ModeChangeEntry, SteeringEntry. Session list/switch/delete via protocol.
- **Compaction** (D037-D039): Token-based trigger with LLM summarization. Proactive (pre-turn check) and reactive (context_overflow recovery). File operation tracking across compactions.
- **Knowledge** (D081-D083): JSONL append-only store with 5 typed entries. Ranked injection into system prompt with 30-day time decay and token budget. `add_knowledge` tool for autonomous recording.
- **Collaboration modes** (D087): ModeKind ("default" | "plan" | "execute"). Plan mode filters tools to read-only set. Mode-specific system prompt prefixes. ModeChangeEntry in session history.
- **Steering queue**: `steer()` injects mid-task messages; `followUp()` queues post-task messages. SteeringEntry persisted in session JSONL. Drained before/after LLM calls.
- **Loop detection**: Tracks tool call signatures in sliding window, detects repeating patterns (length 1-3, 3 repetitions), injects warning message.
- **Project data directory** (D080): `.diligent/` stores sessions, knowledge, and skills. Auto-generated `.gitignore` excludes sessions and knowledge.
- **Diligent Protocol** (`@diligent/protocol`): JSON-RPC v2 protocol with Zod-validated schemas. 11 client request methods (initialize, thread/start, thread/resume, thread/list, thread/read, thread/delete, turn/start, turn/interrupt, turn/steer, mode/set, knowledge/list). 12 server notification types. 2 server request types (approval, user input). All domain models (Message, AgentEvent, ThreadItem, SessionSummary, ProviderAuthStatus) defined as Zod schemas.

## Key Decisions Summary

| ID | Decision | Rationale |
|---|---|---|
| D001 | Bun + TypeScript strict | Fast startup, native TS, good DX |
| D003 | Custom provider abstraction (not ai-sdk) | Full control, no heavy dependency |
| D004 | 18 AgentEvent types (tagged union) | Middle ground between codex-rs (40+) and pi-agent (12). Grew from 15 base via compaction (2), knowledge (1), loop detection (1), steering (1) |
| D006 | JSONL append-only sessions | Simple, no data loss, supports branching |
| D008 | Immutable TurnContext + mutable SessionState | Prevents accidental mutation during tool execution |
| D013 | Tool = object with Zod schema + execute() | Clean, testable, one file per tool |
| D036-REV | Sessions in `.diligent/sessions/` (project-local) | Portable, shareable, easy backup |
| D080 | `.diligent/` project data directory | Separates config (global) from data (project-local) |
| D086 | Codex protocol alignment (SessionManager + itemId + serialization) | Future web UI as thin wrapper, not deep refactor |
| D087 | Collaboration modes (plan/execute) | Tool filtering + system prompt prefix per mode |
| D088 | request_user_input tool | Separate from approval — agent-initiated clarification in all modes |

Full decision log: `docs/plan/decisions.md` (D001-D088)

## Dev Commands

```bash
bun test                  # Run all tests (Bun test runner)
bun run lint              # Lint (Biome)
bun run lint:fix          # Lint + auto-fix
bun run typecheck         # TypeScript type checking
```
