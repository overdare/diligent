# Backlog

## Pending

### P1 — High (core loop quality)

- [ ] **Implement per-tool output limits** — Different char limits per tool (read_file: 50k, shell: 30k, grep: 20k, glob: 20k, edit: 10k, write: 1k) instead of current uniform 50KB/2000 lines for all tools. Configurable via SessionConfig. Reference: attractor spec §5.2. (added: 2026-02-27)
- [ ] **Plan mode bash allowlist/denylist (D087a)** — Regex-based allowlist/denylist for bash tool in plan mode (git status ok, git push blocked). pi-agent's approach: concrete, testable regex patterns, not instruction-only. Stored as `planMode.bashAllowlist` / `planMode.bashDenylist` in config schema. (added: 2026-03-02)
- [x] **`request_user_input` tool (D088)** — Available in all modes (not plan-only). Blocks execution and surfaces questions to the user. Supports multiple questions, options list, and secret masking. Implemented in both Web and TUI. (done: 2026-03-11)
- [x] **Show sub-agent tool call errors in UI** — Tool call failures inside sub-agents are surfaced in the parent thread UI so Web and TUI can display child-agent error details directly in the sub-agent result. (done: 2026-03-11)

### P2 — Medium (future capabilities)

- [ ] **User-friendly API error handling (overloaded, rate-limit, etc.)** — When the LLM API returns transient errors like `overloaded_error` or `rate_limit_error`, show a human-readable message (e.g., "Model is currently busy, retrying…") instead of raw JSON. Implement exponential backoff retry with configurable max attempts. Surface retry progress in both TUI and Web UI. Optionally fall back to a lighter model after N failures. (added: 2026-03-03)

- [x] **Add context budget management for compaction** — The agent now reserves compaction headroom so proactive compaction can run before the context window is fully exhausted. (done: 2026-03-11)
- [ ] **Implement background async piggyback pattern** — The agent loop needs a mechanism to inject asynchronously-produced results (LSP diagnostics, file watcher events, background indexer output) into the next turn's context at natural breakpoints. The pattern is well-documented in research (codex-rs `TurnMetadataState`, pi-agent `getSteeringMessages`, opencode DB re-read) but not implemented or planned. Generalize the existing `getSteeringMessages()` callback design (D011) to a `getPendingInjections()` that drains both user steering messages and background results. See: `docs/research/layers/01-agent-loop.md` § Background Async Piggyback Pattern. (added: 2026-02-25)
- [ ] **Per-mode model override** — Allow config to specify a different model per mode (e.g., plan mode uses a cheaper/faster model). `config.jsonc` → `modes.plan.model`. Passed through AgentLoopConfig when mode is active. (added: 2026-03-02)

### L4 — Approval System ✓ Done (2026-03-11)

> `ctx.approve()` is implemented as a real permission boundary with rule evaluation, inline approval flow, session-memory responses, and frontend approval UX.

- [x] **Rule-based permission matching (D027)** — `PermissionEngine` evaluates `{ permission, pattern, action }` rules with wildcard matching and last-match-wins semantics. (done: 2026-03-11)
- [x] **`ctx.approve()` inline approval flow (D028)** — Tool execution can block on approval requests after rule evaluation, using the shared approval callback path. (done: 2026-03-11)
- [x] **Once/always/reject with session cache (D029)** — `"always"` stores a session-scoped rule so matching future requests auto-resolve; `"reject"` cancels the current request. (done: 2026-03-11)
- [x] **Denied tools removed from LLM list (D070)** — Tools covered by static deny rules are filtered out before the LLM tool list is built. (done: 2026-03-11)
- [x] **TUI approval dialog overlay** — Approval requests are surfaced through the TUI approval dialog with Once / Always / Reject actions. (done: 2026-03-11)

### L9 — MCP (designed, unimplemented)

> All decisions D056-D061 are finalized. Phase 5a spec exists in `docs/plan/layer/implementation-phases.md`.

- [ ] **MCP client integration (`@modelcontextprotocol/sdk`)** — Add official SDK, implement `McpManager` that connects configured servers at startup in parallel. Fire-and-forget connection with timeout per server. (added: 2026-03-02)
- [ ] **Stdio + StreamableHTTP transport (D057)** — Local servers via stdio, remote servers via StreamableHTTP with SSE fallback (try HTTP first). (added: 2026-03-02)
- [ ] **MCP config schema (D058)** — Add `mcp` section to `config.jsonc` Zod schema. Discriminated union on `type`: `local` (command + env) vs `remote` (url + headers). Optional `enabled` and `timeout` per server. (added: 2026-03-02)
- [ ] **MCP tools → tool registry conversion (D059)** — Convert MCP tools to regular tool objects via `convertMcpTool()`. Namespace as `serverName_toolName`. Register in tool registry; goes through same permission system as built-in tools. (added: 2026-03-02)
- [ ] **Dynamic tool list refresh (D061)** — Handle `ToolListChangedNotification` from MCP SDK to refresh registry without restart. (added: 2026-03-02)

### L10 — Multi-Agent ✓ Done (2026-03-02)

- [x] **`task` tool implementation (D062)** — `packages/core/src/tools/task.ts`. Child SessionManager, resume via `task_id`. (done: 2026-03-02)
- [x] **Built-in agent types: `general` + `explore` (D063)** — `packages/core/src/agent/agent-types.ts`. Code-defined defaults, no config override. (done: 2026-03-02)
- [x] **Sub-agent permission isolation (D064)** — `general` excludes `task` (no infinite nesting), `explore` uses PLAN_MODE_ALLOWED_TOOLS only. (done: 2026-03-02)
- [x] **Sub-agent result format (D065)** — `<task_result sessionId="...">` wrapping. TUI renders `[type] desc · elapsed` with preview line. (done: 2026-03-02)

### P2a — Protocol Evolution (P028)

> Codex-RS inspired thread operations and streaming granularity. See `docs/plan/feature/P028-thread-ops-and-streaming-granularity.md`.

- [ ] **Thread Fork (D089)** — `thread/fork` creates independent copy of a thread at current point. New JSONL file with `forkedFromId` metadata. Enables "try a different approach" workflow. (added: 2026-03-05)
- [ ] **Thread Compact (D090)** — `thread/compact/start` exposes existing compaction as user-triggered operation. Rejects during active turns. Emits `thread/compacted` notification. (added: 2026-03-05)
- [ ] **Thread Archive/Unarchive (D091)** — Soft delete via `ArchiveEntry` in JSONL. Filtered from `thread/list` by default. `SESSION_VERSION` 5→6. (added: 2026-03-05)
- [ ] **Thread Name Set (D092)** — `thread/name/set` exposes existing `SessionInfoEntry` name mechanism via protocol. (added: 2026-03-05)
- [ ] **Fine-grained streaming deltas (D093)** — Replace unified `item/delta` with 6 type-specific notifications: `agentMessage/delta`, `reasoning/summaryTextDelta`, `plan/delta`, `toolExecution/outputDelta`, `fileChange/outputDelta`, `reasoning/textDelta`. Old `item/delta` kept as deprecated. (added: 2026-03-05)
- [ ] **Streaming capability negotiation (D094)** — Clients declare `streamingDeltaVersion: 1 | 2` in `initialize`. Enables gradual client migration without breaking existing frontends. (added: 2026-03-05)

### P3 — Low (opportunistic)

- [ ] **Web UI: compaction 이전 메시지 표시 안됨** — compaction 발생 후 Web UI에서 compaction 이전의 메시지/tool call이 보이지 않는다. `hydrateFromThreadRead`가 compaction 이후 context만 로드하기 때문으로 추정. 올바른 UX: 전체 메시지 히스토리를 다 보여주되, compaction 지점에 "컨텍스트가 요약됨" 접힘 표시(divider)를 삽입하는 방식. 세션 파일의 `CompactionEntry`를 읽어 이전 메시지까지 포함해 렌더링 필요. (added: 2026-03-08)

- [ ] **Sync debug-viewer shared types** — `packages/debug-viewer/src/shared/types.ts` duplicates core types by convention (DV-01). Sync with current session entry types (SESSION_VERSION 4, ModeChangeEntry, SteeringEntry, etc.). D086's serialization contract is the reference for format stability. (added: 2026-02-25)
- [ ] **Export/import CLI (D085)** — `diligent export/import` commands for `.diligent/` data as tar.gz archive with `manifest.json`. Flags: `--sessions`, `--knowledge`, `--skills`. Import supports merge (default) and replace modes. (added: 2026-03-02)
- [ ] **Config editing UI (D074)** — `/settings` slash command for read-modify-write config edits. Strips JSONC comments (acceptable tradeoff, warned). (added: 2026-03-02)
- [ ] **Syntax highlighting for code blocks (D055)** — Select and integrate a highlighting library (Shiki, tree-sitter-highlight, or highlight.js) for code blocks in MarkdownView. (added: 2026-03-02)
- [ ] **LSP diagnostics injection (D026)** — After edit/write tool calls, inject LSP diagnostics as a steering message if any errors/warnings are present. Requires background async piggyback pattern first. (added: 2026-03-02)
- [ ] **Suppress raw JSON echo in AssistantMessage from `request_user_input`** — When the agent calls `request_user_input`, Claude sometimes also emits the same questions JSON as a text block, which gets rendered as raw JSON in AssistantMessage. Fix options: (1) system prompt instruction to not output JSON text when using request_user_input, or (2) UI-side suppression when assistant text matches the input of a tool_call in the same turn. (added: 2026-03-02)
- [ ] **Plan document management system under `.diligent/`** — Consolidate all planning/implementation documents under `.diligent/plans/` as structured JSON (not markdown). Each plan file tracks: plan metadata, completion status (pending/in-progress/done/cancelled), and an ordered task list where each task has its own completion state. Enables programmatic querying (e.g., "list incomplete tasks across all plans") and machine-readable progress tracking. CLI and skill integration to view/update plan+task status without manual file editing. (added: 2026-03-02)
