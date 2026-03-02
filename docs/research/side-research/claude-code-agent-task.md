# Side Research: In-Session Task Tracking — Claude Code, opencode, codex-rs, pi-mono

Date: 2026-03-02
Sources: Claude Code CLI (in-context observation), docs/references/codex, docs/references/opencode, docs/references/pi-mono

---

## Overview

Claude Code exposes two distinct systems that are often confused:

1. **`Agent` tool** — spawns real subagent processes with context isolation (multi-agent)
2. **Task tools** (`TaskCreate`/`TaskList`/`TaskUpdate`/`TaskGet`) — session-scoped todo list for progress tracking (UI display only)

These are completely separate mechanisms. The `Agent` tool maps directly to what Diligent's D062 `task` tool aims to do. The Task tools are more like Diligent's debug-viewer session tracking.

---

## Agent Tool

### Purpose

The `Agent` tool launches specialized subagent processes that autonomously handle complex tasks. Each invocation creates a fresh context window or resumes a previous one.

### Parameters

```typescript
interface AgentParams {
  subagent_type: string;       // Which agent type to use
  prompt: string;              // Task description
  description: string;         // Short 3-5 word summary (for display)
  run_in_background?: boolean; // Async execution (default: false)
  resume?: string;             // Agent ID from previous invocation to resume
  isolation?: "worktree";      // Create isolated git worktree
  model?: string;              // Override model (sonnet/opus/haiku)
  max_turns?: number;          // Max agentic turns before stopping
}
```

### Built-in Agent Types

| Agent Type | Description | Tools Available |
|---|---|---|
| `general-purpose` | Research, code search, multi-step tasks | All tools (*) |
| `Explore` | Fast codebase exploration | All except Agent, ExitPlanMode, Edit, Write, NotebookEdit |
| `Plan` | Architecture and implementation planning | All except Agent, ExitPlanMode, Edit, Write, NotebookEdit |
| `claude-code-guide` | Claude Code / API questions | Glob, Grep, Read, WebFetch, WebSearch |
| `statusline-setup` | Configure status line settings | Read, Edit |

### Execution Model

- **Foreground (default)**: Caller blocks until agent completes. Result returned as a single message back to parent.
- **Background** (`run_in_background: true`): Agent runs asynchronously. Caller receives `task_id` immediately. Parent is notified when complete. Caller should NOT poll — uses `TaskOutput` tool to read result when notified.
- **Resume** (`resume: "<agent_id>"`): Agent continues with full previous transcript preserved. Parent passes agent ID returned from prior invocation.

### Context Isolation

Each agent invocation has:
- Fresh context window (no access to parent conversation)
- Own tool permissions (restricted by `subagent_type`)
- Optionally, isolated git worktree (`isolation: "worktree"`)

The agent receives the parent's prompt but NOT the full conversation history (unless it explicitly "has access to current context" per documentation).

### Result Format

Agent returns a single message to the parent. The parent's LLM reads this result as tool output text. Background agents write to an `output_file` path; the parent reads it via `Read` tool or `TaskOutput`.

Background task result structure (from `TaskOutput`):
```
{
  task_id: string,
  status: "running" | "completed" | "failed",
  output: string  // agent's final message
}
```

### Depth Control

Implicit: Agent types like `Explore` and `Plan` don't have access to the `Agent` tool in their allowed tools list. `general-purpose` has `*` (all tools), meaning it could theoretically spawn further agents — but this is discouraged in documentation.

### Worktree Isolation

`isolation: "worktree"` creates a temporary git worktree at `.claude/worktrees/`. The worktree is:
- Auto-cleaned up if the agent makes no changes
- Returned as a path+branch if the agent made changes
- Useful for independent file edits that shouldn't conflict

### Resume / Agent ID

Each completed agent invocation returns an `agent_id`. This can be passed to a future invocation's `resume` parameter to continue with the same context. The resumed agent picks up where it left off.

---

## Task Tools (Session-Scoped Todo List)

### Purpose

Visual progress tracking within a single session. NOT a multi-agent system. Items are shown in the TUI as a checklist, helping the user see what the agent is doing.

### Tool Set

- **`TaskCreate`** — Add a new task (status: pending)
- **`TaskList`** — View all tasks in the current session
- **`TaskGet`** — Get full details of a specific task by ID
- **`TaskUpdate`** — Change status, subject, description, owner, dependencies

### Task Schema

```typescript
interface Task {
  id: string;           // Auto-assigned
  subject: string;      // Imperative title: "Fix auth bug"
  description: string;  // Detailed context
  activeForm: string;   // Present continuous: "Fixing auth bug" (shown in spinner)
  status: "pending" | "in_progress" | "completed" | "deleted";
  owner?: string;       // Agent name if claimed
  blocks?: string[];    // Task IDs that can't start until this completes
  blockedBy?: string[]; // Task IDs that must complete first
  metadata?: Record<string, any>;
}
```

### Status Lifecycle

```
pending → in_progress → completed
              ↓
           deleted
```

### Dependency System

Tasks support `blocks`/`blockedBy` relationships. A task with unresolved `blockedBy` tasks cannot be started. This enables DAG-style task graphs within a session.

### Usage Patterns (from Claude Code docs)

**When to create tasks:**
- 3+ distinct steps required
- Non-trivial, complex work
- User explicitly asks for todo list
- User provides a numbered list of things to do
- Multiple tasks received at once

**When NOT to create tasks:**
- Single trivial task
- Task takes fewer than 3 trivial steps
- Purely conversational/informational

**Workflow:**
1. Create tasks when scope is known (after understanding requirements)
2. Mark task `in_progress` BEFORE beginning work on it
3. Mark `completed` only when FULLY done (tests passing, no errors)
4. If blocked, create a new task describing the blocker
5. After completing, call `TaskList` to find next available task

---

## Cross-Codebase: In-Session Todo / Task Tracking Tools

### opencode — `todowrite` + `todoread` (두 개 분리 툴, SQLite 영속화)

**Files**:
- `packages/opencode/src/tool/todo.ts` — 툴 정의
- `packages/opencode/src/session/todo.ts` — Todo 모델 + DB 레이어
- `packages/opencode/src/session/session.sql.ts` — SQLite 스키마

**Schema**:
```typescript
// TodoWriteTool (tool id: "todowrite")
{
    todos: z.array(z.object({
        content:  z.string(),  // 태스크 설명
        status:   z.string(),  // "pending" | "in_progress" | "completed" | "cancelled"
        priority: z.string(),  // "high" | "medium" | "low"
    }))
}

// TodoReadTool (tool id: "todoread") — 레지스트리에서 주석 처리됨
{} // 파라미터 없음, 현재 todo 목록 반환
```

**SQLite 스키마** (`session.sql.ts`):
```typescript
export const TodoTable = sqliteTable("todo", {
    session_id: text().notNull().references(() => SessionTable.id, { onDelete: "cascade" }),
    content:    text().notNull(),
    status:     text().notNull(),
    priority:   text().notNull(),
    position:   integer().notNull(),
    ...Timestamps,
}, (table) => [
    primaryKey({ columns: [table.session_id, table.position] }),
])
```

**Key behavior**:
- `TodoWriteTool`: 전체 목록을 **원자적으로 교체** (항목 추가/삭제 없이 매번 전체를 덮어씀)
- `TodoReadTool`: 정의는 있지만 **레지스트리에서 주석 처리됨** (LLM에게 노출 안 됨)
- 스토리지: **SQLite DB** (세션 삭제 시 cascade)
- 서브에이전트에서 **명시적으로 deny** — `task.ts`에서 child session 생성 시 `todowrite`/`todoread` 모두 `action: "deny"` + `tools: { todowrite: false, todoread: false }` 비활성화
- `Bus.publish(Event.Updated)` — 업데이트 시 이벤트 발행, UI가 구독

---

### codex-rs — `update_plan` (plan documentation, not CRUD)

**File**: `core/src/tools/handlers/plan.rs`

```rust
// Tool name: update_plan
{
    plan_items: [{ step: String, status: "pending"|"in_progress"|"completed" }],
    explanation: Option<String>
}
```

**Key behavior**:
- 기능적으로 아무것도 안 함. 코드 주석: _"This function doesn't do anything useful. However, it gives the model a structured way to record its plan that clients can read and render."_
- `EventMsg::PlanUpdate(args)` 이벤트 발행 → 클라이언트가 렌더링, LLM이 읽어오지 못함
- 한 번에 `in_progress` 항목 최대 1개
- **Plan mode에서 사용 불가** — "update_plan is a TODO/checklist tool and is not allowed in Plan mode"
- CRUD 아님: 매 호출 시 전체 목록 덮어쓰기

---

### pi-mono — `todo` extension (단일 툴 CRUD)

**File**: `packages/coding-agent/examples/extensions/todo.ts`

```typescript
// Single tool: "todo"
const TodoParams = Type.Object({
    action: StringEnum(["list", "add", "toggle", "clear"]),
    text:   Type.Optional(Type.String()),  // for "add"
    id:     Type.Optional(Type.Number()),  // for "toggle"
})
```

**Key behavior**:
- 진짜 CRUD (add/list/toggle/clear)
- 스토리지: **in-memory**, 세션 히스토리의 tool result를 리플레이해서 재구성
- 브랜치 자동 인식 (세션 분기 시 해당 시점 상태 복원)
- `/todos` 슬래시 커맨드 → TUI 컴포넌트로 진행 상황 표시 (예: "3/5 completed")
- 서브에이전트 접근 제한 없음 (확장 공유 시 상속)

---

### Claude Code — 4개 분리 툴 (TaskCreate/TaskList/TaskGet/TaskUpdate)

**Key behavior**:
- `status`: pending → in_progress → completed → deleted
- `activeForm`: in_progress 중 스피너에 표시되는 현재진행형 레이블
- `blocks`/`blockedBy`: 태스크 간 DAG 의존성
- `owner`: 에이전트가 태스크를 claim 가능
- **서브에이전트 접근 불가** — `Agent` 툴 실행 시 부모의 태스크 목록에 접근 불가

---

### Comparison

| Aspect | opencode `todowrite` | codex-rs `update_plan` | pi-mono `todo` | Claude Code Tasks |
|---|---|---|---|---|
| **Type** | CRUD (replace-all) | Plan documentation | CRUD (per-item) | CRUD (per-item) |
| **Storage** | SQLite DB | Event stream | In-memory + replay | Internal |
| **LLM reads back** | TodoRead (비활성) | No | Yes (`list`) | Yes (TaskList/Get) |
| **Sub-agent access** | **Explicitly denied** | N/A | Inherits | Denied |
| **Persistence** | Yes (DB, session-scoped) | No | Session replay | Unknown |
| **Dependencies** | No | No | No | Yes (blocks/blockedBy) |
| **Priority** | Yes (high/medium/low) | No | No | No |
| **UI** | Bus event → subscriber | Client renders | `/todos` command | TUI checklist |

---

## Implications for Diligent

1. **D064의 `todowrite`/`todoread` deny 규칙은 정확히 opencode 패턴**: 이전 분석은 틀렸음. anomalyco/opencode는 `todowrite`/`todoread` 툴이 실제로 존재하고, 서브에이전트에서 명시적으로 deny함. D064 설계는 이 패턴을 그대로 따른 것 — 올바름.

2. **Diligent에 todo 툴 추가 여부**: opencode 방식(SQLite + replace-all)이 세션 시스템과 가장 잘 맞음. Diligent는 이미 JSONL 세션 영속화가 있으므로 pi-mono 방식(session replay)도 가능. D062 구현 후 별도 P2 백로그 항목으로 추가 권장.

3. **D062와 독립적**: `task` 툴(서브에이전트 스폰)은 todo 시스템과 무관하게 구현 가능. D064의 deny 규칙은 Diligent에 todo 툴이 없는 MVP 단계에서는 no-op이지만, 미래 구현을 위한 올바른 forward reference.

---

## Key Design Differences vs D062

| Aspect | Claude Code `Agent` tool | Diligent D062 `task` tool |
|---|---|---|
| **Architecture** | In-process subagent with own context | Child session via SessionManager |
| **Persistence** | Agent ID for resume, `output_file` for background | `task_id` = sessionId, full JSONL session |
| **Session store** | Internal (not user-visible) | `.diligent/sessions/` — visible, listable |
| **Background support** | `run_in_background: true` | Not in MVP scope |
| **Agent types** | Code-defined, tool-list-based restriction | Code-defined, mode+permission restriction |
| **Worktree isolation** | `isolation: "worktree"` | Not planned |
| **Result format** | Raw text | `<task_result>` wrapped + `task_id` (opencode pattern) |
| **Depth control** | Tool list restriction (explore/plan lack Agent) | Permission deny rule (`task` tool denied by default) |
| **TUI display** | task tools = separate checklist UI | AgentEvent-based (SubAgentSpawnEvent etc.) |

---

## Implications for D062 Implementation

1. **`subagent_type` param**: Same name as Claude Code's Agent tool — good for consistency. Maps to Diligent's agent type system (D063).

2. **`task_id` for resume**: Claude Code uses `agent_id` (opaque handle), opencode uses `task_id = sessionId`. Diligent's D062 spec uses `task_id` → Diligent sessionId. This is the opencode pattern, which is cleaner since sessions are already persisted.

3. **Result format**: Claude Code returns raw text. D062 spec wraps in `<task_result>` + returns `task_id` (resume handle). This is better — the LLM has a clear extraction target and can resume if needed.

4. **No background at MVP**: Claude Code's background agent mode is powerful but complex (requires TaskOutput polling + notification system). D062 spec is synchronous (blocks until child completes). Correct for MVP.

5. **Depth via permission**: Claude Code's `Explore` agent can't spawn agents because Agent isn't in its tool list. D062/D064 uses the same pattern: deny `task` permission in child sessions. Consistent design.

6. **The Task tools (TodoCreate etc.) are separate**: Claude Code's task/todo checklist system is a UI feature, not multi-agent. Diligent doesn't need an equivalent at MVP — the session list in the TUI serves a similar purpose.
