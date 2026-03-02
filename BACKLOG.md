# Backlog

## Pending

### P1 — High (core loop quality)

- [ ] **Implement per-tool output limits** — Different char limits per tool (read_file: 50k, shell: 30k, grep: 20k, glob: 20k, edit: 10k, write: 1k) instead of current uniform 50KB/2000 lines for all tools. Configurable via SessionConfig. Reference: attractor spec §5.2. (added: 2026-02-27)
- [ ] **Plan mode bash allowlist/denylist (D087a)** — Regex-based allowlist/denylist for bash tool in plan mode (git status ok, git push blocked). pi-agent's approach: concrete, testable regex patterns, not instruction-only. Stored as `planMode.bashAllowlist` / `planMode.bashDenylist` in config schema. (added: 2026-03-02)
- [ ] **`request_user_input` tool (D088)** — Available in all modes (not plan-only). Blocks execution and surfaces a question to the user via TUI TextInput overlay. Returns user's text response. Supports multiple questions, options list, secret masking. See phase-5a plan. (updated: 2026-03-02)

### P2 — Medium (future capabilities)

- [ ] **Add context budget management for compaction** — Context compaction fails when the context window is completely full (no room to run the compaction itself). The agent needs to reserve ~20% of the context window as headroom so compaction can always be triggered before it's too late. Investigate the right threshold and implement a proactive compaction strategy. (added: 2026-02-25)
- [ ] **Implement background async piggyback pattern** — The agent loop needs a mechanism to inject asynchronously-produced results (LSP diagnostics, file watcher events, background indexer output) into the next turn's context at natural breakpoints. The pattern is well-documented in research (codex-rs `TurnMetadataState`, pi-agent `getSteeringMessages`, opencode DB re-read) but not implemented or planned. Generalize the existing `getSteeringMessages()` callback design (D011) to a `getPendingInjections()` that drains both user steering messages and background results. See: `docs/research/layers/01-agent-loop.md` § Background Async Piggyback Pattern. (added: 2026-02-25)
- [ ] **Per-mode model override** — Allow config to specify a different model per mode (e.g., plan mode uses a cheaper/faster model). `diligent.jsonc` → `modes.plan.model`. Passed through AgentLoopConfig when mode is active. (added: 2026-03-02)

### L4 — Approval System (stub → real implementation)

> Currently `ctx.approve()` auto-returns `"once"`. All decisions D027-D031 are designed but unimplemented.

- [ ] **Rule-based permission matching (D027)** — `PermissionEngine` with `{ permission, pattern, action }` rules, wildcard matching, last-match-wins. Actions: `"allow"` / `"deny"` / `"prompt"`. Load from `permissions` array in config. See phase-5a plan. (updated: 2026-03-02)
- [ ] **`ctx.approve()` inline approval flow (D028)** — Replace auto-approve stub with real blocking permission gate. `AgentLoopConfig.approve` callback; TUI provides dialog. `ApprovalResponse = "once" | "always" | "reject"`. See phase-5a plan. (updated: 2026-03-02)
- [ ] **Once/always/reject with session cache (D029)** — `"always"` adds rule to `PermissionEngine` session cache; future matching calls auto-resolve. `"reject"` cancels current call (cascading all pending is post-MVP). See phase-5a plan. (updated: 2026-03-02)
- [ ] **Denied tools removed from LLM list (D070)** — `filterAllowedTools()` in loop.ts removes tools with static deny rules before building LLM tool list. See phase-5a plan. (updated: 2026-03-02)
- [ ] **TUI approval dialog overlay** — New `ApprovalDialog` component (3-button: Once / Always / Reject). Wire to `app.ts` approve callback. Block agent loop while shown. See phase-5a plan. (updated: 2026-03-02)

### L9 — MCP (designed, unimplemented)

> All decisions D056-D061 are finalized. Phase 5a spec exists in `docs/plan/implementation-phases.md`.

- [ ] **MCP client integration (`@modelcontextprotocol/sdk`)** — Add official SDK, implement `McpManager` that connects configured servers at startup in parallel. Fire-and-forget connection with timeout per server. (added: 2026-03-02)
- [ ] **Stdio + StreamableHTTP transport (D057)** — Local servers via stdio, remote servers via StreamableHTTP with SSE fallback (try HTTP first). (added: 2026-03-02)
- [ ] **MCP config schema (D058)** — Add `mcp` section to `diligent.jsonc` Zod schema. Discriminated union on `type`: `local` (command + env) vs `remote` (url + headers). Optional `enabled` and `timeout` per server. (added: 2026-03-02)
- [ ] **MCP tools → tool registry conversion (D059)** — Convert MCP tools to regular tool objects via `convertMcpTool()`. Namespace as `serverName_toolName`. Register in tool registry; goes through same permission system as built-in tools. (added: 2026-03-02)
- [ ] **Dynamic tool list refresh (D061)** — Handle `ToolListChangedNotification` from MCP SDK to refresh registry without restart. (added: 2026-03-02)

### L10 — Multi-Agent ✓ Done (2026-03-02)

- [x] **`task` tool implementation (D062)** — `packages/core/src/tools/task.ts`. Child SessionManager, resume via `task_id`. (done: 2026-03-02)
- [x] **Built-in agent types: `general` + `explore` (D063)** — `packages/core/src/agent/agent-types.ts`. Code-defined defaults, no config override. (done: 2026-03-02)
- [x] **Sub-agent permission isolation (D064)** — `general` excludes `task` (no infinite nesting), `explore` uses PLAN_MODE_ALLOWED_TOOLS only. (done: 2026-03-02)
- [x] **Sub-agent result format (D065)** — `<task_result sessionId="...">` wrapping. TUI renders `[type] desc · elapsed` with preview line. (done: 2026-03-02)

### P3 — Low (opportunistic)

- [ ] **Sync debug-viewer shared types** — `packages/debug-viewer/src/shared/types.ts` duplicates core types by convention (DV-01). Sync with current session entry types (SESSION_VERSION 4, ModeChangeEntry, SteeringEntry, etc.). D086's serialization contract is the reference for format stability. (added: 2026-02-25)
- [ ] **Export/import CLI (D085)** — `diligent export/import` commands for `.diligent/` data as tar.gz archive with `manifest.json`. Flags: `--sessions`, `--knowledge`, `--skills`. Import supports merge (default) and replace modes. (added: 2026-03-02)
- [ ] **Config editing UI (D074)** — `/settings` slash command for read-modify-write config edits. Strips JSONC comments (acceptable tradeoff, warned). (added: 2026-03-02)
- [ ] **Syntax highlighting for code blocks (D055)** — Select and integrate a highlighting library (Shiki, tree-sitter-highlight, or highlight.js) for code blocks in MarkdownView. (added: 2026-03-02)
- [ ] **LSP diagnostics injection (D026)** — After edit/write tool calls, inject LSP diagnostics as a steering message if any errors/warnings are present. Requires background async piggyback pattern first. (added: 2026-03-02)
- [ ] **Plan document management system under `.diligent/`** — Consolidate all planning/implementation documents under `.diligent/plans/` as structured JSON (not markdown). Each plan file tracks: plan metadata, completion status (pending/in-progress/done/cancelled), and an ordered task list where each task has its own completion state. Enables programmatic querying (e.g., "list incomplete tasks across all plans") and machine-readable progress tracking. CLI and skill integration to view/update plan+task status without manual file editing. (added: 2026-03-02)