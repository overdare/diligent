# Project Status

## Current Phase

**Continuous development** — Phase 4c complete. No further numbered phases planned.

All implementation phases (0–4c) are done. Development continues as iterative improvements driven by the backlog. See `BACKLOG.md` for the full work list.

**Layers implemented:**

| Layer | Status |
|---|---|
| L0 Provider | Done (Anthropic + OpenAI, error classification, retry) |
| L1 Agent Loop | Done (full events, compaction, steering, loop detection, modes) |
| L2 Tool System | Done (truncation, progress, approval hook stub) |
| L3 Core Tools | Done (8 tools incl. add_knowledge) |
| L4 Approval | **Stub** — auto-approve only. Real implementation in backlog. |
| L5 Config | Done (3-layer JSONC, CLAUDE.md, env overrides) |
| L6 Session | Done (JSONL, compaction, knowledge, steering, mode entries) |
| L7 TUI & Commands | Done (component framework, overlays, 15 commands) |
| L8 Skills | Done (SKILL.md discovery, frontmatter, system prompt injection) |
| L9 MCP | **Not started** — design complete (D056-D061), in backlog. |
| L10 Multi-Agent | Done (D062-D065: task tool, agent types, permission isolation, result format) |

**Backlog summary (18 pending items):**
- **P1** (3): Per-tool output limits · Plan mode bash rules · `request_user_input` tool
- **P2** (3): Context budget headroom · Background async piggyback · Per-mode model override
- **L4** (5): Rule-based permissions · ctx.ask() flow · Once/always/reject · Denied tool removal · TUI approval dialog
- **L9** (5): MCP client · Transports · Config schema · Tool conversion · Dynamic refresh
- **P3** (6): Debug-viewer sync · Export/import · Config editing UI · Syntax highlighting · LSP diagnostics · Plan document management system

## Phases Complete

| Phase | Completed | Key Artifacts |
|---|---|---|
| Phase 0: Skeleton | 2026-02-24 | Monorepo scaffolding, core type definitions (AgentEvent, Tool, EventStream, Provider interfaces) |
| Phase 1: Minimal Agent | 2026-02-24 | Agent loop (180 lines), EventStream (86 lines), Anthropic provider, bash tool, readline TUI, E2E test package |
| Phase 2: Functional Coding Agent | 2026-02-25 | All 7 core tools, full 15 AgentEvent types, retry with exponential backoff, markdown rendering, spinner, auto-truncation (D025), ~2,300 lines of production code |
| Phase 3a: Config & Session Persistence | 2026-02-25 | D086 protocol readiness (itemId, SerializableError, ApprovalResponse), .diligent/ directory convention, JSONC config (3-layer hierarchy, Zod schema, env overrides), CLAUDE.md discovery (findUp + .git boundary), JSONL session persistence (DeferredWriter, tree structure), context builder (tree→linear), SessionManager mediator, EventStream.subscribe() observer, CLI --continue/--list flags, 254 tests |
| Phase 3b: Compaction, Knowledge & Multi-Provider | 2026-02-25 | Compaction system (token estimation, LLM summarization, file operation tracking, proactive + reactive triggers), Knowledge store (JSONL, ranked injection, add_knowledge tool, 30-day time decay), OpenAI Responses API provider, model registry with alias resolution, provider selection by model prefix, 18 AgentEvent types, SESSION_VERSION 2, 323 tests |
| Phase 4a: TUI Component Framework | 2026-02-26 | Component interface (render/handleInput/invalidate), TUI renderer with line-level diffing + synchronized output, overlay stack with compositing, StdinBuffer for input splitting, Kitty keyboard protocol, InputEditor with cursor/history/Ctrl shortcuts, MarkdownView with newline-gated streaming, SpinnerComponent, StatusBar, ChatView (AgentEvent handler), ConfirmDialog overlay, Container layout, app.ts rewritten to component-based architecture, 404 tests |
| Phase 4b: Skills + Slash Commands | 2026-02-27 | Skill system (L8): SKILL.md frontmatter parsing, multi-location discovery (.diligent/skills, .agents/skills, ~/.config/diligent/skills, config paths), first-loaded-wins dedup, progressive disclosure (metadata in system prompt, body on demand), extractBody. Command system (L7): CommandRegistry with register/lookup/alias/complete, parseCommand with /command args and /skill:name patterns, double-slash escape. 15 built-in commands (/help, /model, /new, /resume, /status, /compact, /clear, /exit, /version, /config, /cost, /bug, /reload, /skills, /skill:*). ListPicker overlay component with type-to-filter and scrolling. InputEditor Tab autocomplete for commands. App integration: command dispatch in handleSubmit, CommandContext, reloadConfig. Config schema gains skills section, system prompt gains skillsSection parameter. 513 tests |
| Phase 4c: Print Mode + Collaboration Modes | 2026-02-27 | Print mode: stdin pipe detection (echo "..." \| diligent). --mode CLI flag. ModeKind type ("default"\|"plan"\|"execute") + PLAN_MODE_ALLOWED_TOOLS + MODE_SYSTEM_PROMPT_PREFIXES in agent/types.ts. Tool filtering for plan mode in loop.ts. Mode system prompt prefix injection. ModeChangeEntry session entry type, SESSION_VERSION 2→3, appendModeChange() on SessionManager. mode field in DiligentConfigSchema + AppConfig. /mode command (direct switch + ListPicker overlay). Status bar [plan]/[execute] chip. App factory agentConfig + setMode() wired to SessionManager. 575 tests |
