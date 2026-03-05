---
id: P031
status: done
created: 2026-03-05
---

# Collab Event Unification, agentId→threadId 통합, Interaction Events

## Context

현재 collab 이벤트 설계에 3가지 문제가 있다:

1. **중복 이벤트**: `COLLAB_TOOL_START/END`, `COLLAB_TURN_START`는 기존 `ITEM_STARTED/COMPLETED`, `TURN_STARTED`와 본질적으로 동일. child agent를 구분하는 필드만 추가하면 되는 것을 별도 이벤트 타입으로 만듦.
2. **ID 중복**: `agentId`(registry 내부 시퀀셜 `agent-0001`)와 child SessionManager의 `sessionId`(= threadId)가 별개로 존재하지만 실질적으로 같은 대상을 가리킴. threadId로 통일하면 protocol 전체에서 일관된 식별 체계를 가짐.
3. **누락 이벤트**: `send_input`(에이전트 간 메시지 전달)에 대한 이벤트가 없어서 UI에서 상호작용이 보이지 않음.

## Goal

- Child agent를 threadId(= sessionId)로 식별하도록 통일
- 중복 collab 이벤트 3개를 제거하고 기존 이벤트에 통합
- `collab_interaction_begin/end` 이벤트를 추가하여 에이전트 간 메시지 전달을 UI에 표시

## Prerequisites

- Collab layer (P007, done) — spawn_agent / wait / send_input / close_agent 4-tool 체계
- Protocol notification system (D004, D086)

## Artifact

```
User → "analyze these two files in parallel"
Agent → spawn_agent("file1.ts") → returns { thread_id: "sess_abc", nickname: "Oak" }
Agent → spawn_agent("file2.ts") → returns { thread_id: "sess_def", nickname: "Elm" }
Agent → send_input("sess_abc", "also check imports")
  → UI shows: "→ Sent message to Oak" with prompt text
  → Child Oak's tool calls appear as regular ITEM_STARTED with threadId="sess_abc"
Agent → wait(["sess_abc", "sess_def"])
```

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| ID 체계 | `agentId`(agent-0001) → `threadId`(= child sessionId). `nextId()` 제거. nickname 유지 |
| AgentEvent types | tool_start/end/update, turn_start에 optional threadId/nickname 추가. collab_tool_*/turn_* 제거. collab_interaction_begin/end 추가 |
| Protocol notifications | COLLAB_TOOL_*/TURN_* 제거. ITEM_*/TURN_STARTED에 childThreadId/nickname 추가. COLLAB_INTERACTION_BEGIN/END 추가 |
| Collab boundary events | agentId → threadId 필드명 변경 (spawn/wait/close begin/end) |
| Tool params | spawn returns `thread_id`, send_input/wait/close take `id` (값이 threadId로 변경) |
| Session persistence | CollabSessionMeta.agentId 제거 (sessionId가 곧 identity) |
| Web UI | thread-store에서 threadId로 child event 라우팅. interaction 렌더링 |

### What does NOT change

- Collab boundary 이벤트 6개 (spawn/wait/close begin/end) — 구조는 유지, 필드명만 변경
- TUI collab 렌더링 (collab_tool_*/turn_* 미사용 확인됨, boundary event의 agentId→threadId만 반영)
- Agent loop, SessionManager, tool execution 로직
- nickname 체계 (NicknamePool 유지)

## File Manifest

### packages/core/src/agent/

| File | Action | Description |
|------|--------|------------|
| `types.ts` | MODIFY | tool_start/end/update, turn_start에 childThreadId?/nickname? 추가. collab_tool_*/turn_* 제거. collab_interaction_begin/end 추가. 모든 collab event의 agentId→childThreadId |

### packages/protocol/src/

| File | Action | Description |
|------|--------|------------|
| `methods.ts` | MODIFY | COLLAB_TOOL_*/TURN_* 제거. COLLAB_INTERACTION_BEGIN/END 추가 |
| `server-notifications.ts` | MODIFY | 3개 schema 제거, item/turn에 childThreadId 추가, interaction schema 추가. 기존 collab schema의 agentId→childThreadId |
| `data-model.ts` | MODIFY | AgentEventSchema 동기화. CollabAgentRef/StatusEntry의 agentId→threadId |

### packages/core/src/collab/

| File | Action | Description |
|------|--------|------------|
| `types.ts` | MODIFY | AgentEntry.id를 threadId(sessionId)로. CollabAgentEvent → AgentEvent 수용. agentId 필드 제거 |
| `registry.ts` | MODIFY | nextId() 제거. spawn에서 childManager.sessionId를 ID로 사용. child event forwarding 통합. sendInput에 interaction 이벤트 |
| `spawn-agent.ts` | MODIFY | 반환값 agent_id → thread_id |
| `send-input.ts` | MODIFY | param 설명 업데이트 |
| `wait.ts` | MODIFY | param 설명 업데이트 |
| `close-agent.ts` | MODIFY | param 설명 업데이트 |

### packages/core/src/session/

| File | Action | Description |
|------|--------|------------|
| `types.ts` | MODIFY | CollabSessionMeta에서 agentId 제거 (sessionId가 identity). SessionHeader.agentId 제거 |
| `manager.ts` | MODIFY | getHistoricalCollabAgents()에서 thread_id 파싱으로 변경 |
| `persistence.ts` | MODIFY | SessionHeader 직렬화에서 agentId 제거 |

### packages/core/src/

| File | Action | Description |
|------|--------|------------|
| `app-server/server.ts` | MODIFY | 3개 collab case 제거, item/turn에 childThreadId 전달, interaction case 추가, restoreAgent 시그니처 변경 |
| `notification-adapter.ts` | MODIFY | 동일 패턴 |

### packages/web/src/client/

| File | Action | Description |
|------|--------|------------|
| `lib/thread-store.ts` | MODIFY | agentId→threadId. childThreadId 있는 tool/turn → spawn item 중첩. interaction reducer |
| `lib/tool-info.ts` | MODIFY | agentId 참조 업데이트 |
| `components/CollabEventBlock.tsx` | MODIFY | agentId→threadId. interaction eventType 렌더링 |
| `components/CollabGroup.tsx` | MODIFY | agentId→threadId (필요시) |

### packages/cli/src/tui/

| File | Action | Description |
|------|--------|------------|
| `components/chat-view.ts` | MODIFY | collab boundary event의 agentId→threadId |

### tests

| File | Action | Description |
|------|--------|------------|
| `packages/core/test/collab/registry.test.ts` | MODIFY | agentId→threadId, unified event 검증 |
| `packages/core/test/collab/tools.test.ts` | MODIFY | agentId→threadId |
| `packages/core/test/collab/integration.test.ts` | MODIFY | agentId→threadId |
| `packages/core/test/collab/nicknames.test.ts` | MODIFY | agentId→threadId |
| `packages/web/test/thread-store.test.ts` | MODIFY | agentId→threadId, unified event 검증 |
| `packages/web/test/tool-info.test.ts` | MODIFY | agentId→threadId |

## Implementation Tasks

### Task 1: agentId → threadId 리네이밍 (protocol + core types)

**Files:** `packages/core/src/agent/types.ts`, `packages/protocol/src/data-model.ts`, `packages/protocol/src/server-notifications.ts`, `packages/protocol/src/methods.ts`, `packages/core/src/collab/types.ts`, `packages/core/src/session/types.ts`

모든 collab 관련 타입에서 `agentId` 필드를 `threadId` (또는 notification params에서는 `childThreadId`)로 변경.

#### 1a. Protocol data-model

```typescript
// CollabAgentRef: agentId → threadId
export const CollabAgentRefSchema = z.object({
  threadId: z.string(),  // was agentId
  nickname: z.string().optional(),
  description: z.string().optional(),
});

// CollabAgentStatusEntry: agentId → threadId
export const CollabAgentStatusEntrySchema = z.object({
  threadId: z.string(),  // was agentId
  nickname: z.string().optional(),
  status: CollabAgentStatusSchema,
  message: z.string().optional(),
});
```

#### 1b. AgentEvent collab types

```typescript
// 모든 collab boundary event에서 agentId → childThreadId
// 예: collab_spawn_end
| {
    type: "collab_spawn_end";
    callId: string;
    childThreadId: string;  // was agentId
    nickname?: string;
    description?: string;
    prompt: string;
    status: CollabAgentStatus;
    message?: string;
  }
// collab_close_begin/end, collab_wait_begin/end 동일 패턴
```

#### 1c. Server notification schemas

```typescript
// 기존 collab notification params에서 agentId → childThreadId
// 예: CollabSpawnEndNotificationSchema
params: z.object({
  threadId: z.string(),           // parent thread (기존 유지)
  callId: z.string(),
  childThreadId: z.string(),      // was agentId
  nickname: z.string().optional(),
  // ...
})
```

#### 1d. Core types

```typescript
// AgentEntry (collab/types.ts)
export interface AgentEntry {
  threadId: string;  // was id (agent-0001), now child sessionId
  nickname: string;
  // ...
}

// CollabSessionMeta (session/types.ts) — agentId 제거
export interface CollabSessionMeta {
  nickname: string;
  description?: string;
  // agentId 제거 — sessionId가 곧 identity
}

// SessionHeader — agentId 제거
export interface SessionHeader {
  id: string;       // sessionId = threadId
  nickname?: string;
  description?: string;
  // agentId 제거
}
```

**Verify:** 타입 에러만 확인 (아직 구현체는 안 고침)

### Task 2: Registry에서 nextId() 제거, sessionId를 threadId로 사용

**Files:** `packages/core/src/collab/registry.ts`, `packages/core/src/collab/spawn-agent.ts`

#### 2a. Registry.spawn() 변경

```typescript
// nextId() 제거
// spawn()에서 child SessionManager 생성 후 sessionId를 threadId로 사용

spawn(params: { ... }): { threadId: string; nickname: string } {
  const nickname = this.pool.reserve();
  const abortController = new AbortController();

  // Create child SessionManager first to get sessionId
  const childManager = this.deps.sessionManagerFactory(childConfig);
  const threadId = childManager.sessionId;  // available immediately (DeferredWriter)
  const callId = threadId;

  this.emit({ type: "collab_spawn_begin", callId, prompt: params.prompt });

  const entry: AgentEntry = {
    threadId,  // was id: agentId
    nickname,
    sessionManager: childManager,
    // ...
  };
  this.agents.set(threadId, entry);  // keyed by threadId now

  // Background promise uses threadId throughout
  // ...

  return { threadId, nickname };
}
```

#### 2b. spawn-agent.ts — tool 반환값

```typescript
// 기존: return { agent_id: result.agentId, nickname }
// 변경: return { thread_id: result.threadId, nickname }
```

**Note:** LLM이 사용하는 tool param `id`의 값이 `agent-0001` → `sess_xxx` 형태로 바뀜. tool description은 "Thread ID"로 업데이트.

#### 2c. registry — child event forwarding 통합

```typescript
// spawn background promise에서:
// 기존: child tool_start → collab_tool_start({ agentId, ... })
// 변경: child tool_start → tool_start({ ...event, childThreadId: threadId, nickname })

case "turn_start":
  turnNumber++;
  this.emit({ ...event, childThreadId: threadId, nickname, turnNumber });
  break;

case "tool_start":
  this.emit({ ...event, childThreadId: threadId, nickname });
  break;

case "tool_end":
  this.emit({ ...event, childThreadId: threadId, nickname });
  break;
```

#### 2d. registry.sendInput — interaction 이벤트 발송

```typescript
async sendInput(threadId: string, message: string): Promise<void> {
  const entry = this.agents.get(threadId);
  if (!entry) throw new Error(`Unknown agent thread: ${threadId}`);

  const callId = `interaction-${threadId}-${Date.now()}`;
  this.emit({
    type: "collab_interaction_begin",
    callId,
    receiverThreadId: threadId,
    receiverNickname: entry.nickname,
    prompt: message,
  });

  entry.sessionManager.steer(message);

  this.emit({
    type: "collab_interaction_end",
    callId,
    receiverThreadId: threadId,
    receiverNickname: entry.nickname,
    prompt: message,
    status: toCollabStatus(entry.status),
  });
}
```

**Verify:** `bun test packages/core/test/collab/`

### Task 3: 중복 이벤트 제거 + interaction 이벤트 추가 (protocol)

**Files:** `packages/protocol/src/methods.ts`, `packages/protocol/src/server-notifications.ts`, `packages/protocol/src/data-model.ts`, `packages/core/src/agent/types.ts`

#### 3a. 제거

```typescript
// methods.ts — 3개 제거
// COLLAB_TOOL_START, COLLAB_TOOL_END, COLLAB_TURN_START

// server-notifications.ts — 3개 schema 제거
// CollabToolStartNotificationSchema, CollabToolEndNotificationSchema, CollabTurnStartNotificationSchema

// data-model.ts — AgentEventSchema에서 3개 제거
// collab_tool_start, collab_tool_end, collab_turn_start

// agent/types.ts — AgentEvent에서 3개 제거
// collab_tool_start, collab_tool_end, collab_turn_start
```

#### 3b. 기존 이벤트에 childThreadId 추가

```typescript
// agent/types.ts
| { type: "turn_start"; turnId: string; childThreadId?: string; nickname?: string; turnNumber?: number }
| { type: "tool_start"; itemId: string; toolCallId: string; toolName: string; input: unknown; childThreadId?: string; nickname?: string }
| { type: "tool_update"; ...; childThreadId?: string; nickname?: string }
| { type: "tool_end"; ...; childThreadId?: string; nickname?: string }

// server-notifications.ts — 기존 notification params에 optional 필드 추가
TurnStartedNotificationSchema.params += { childThreadId: z.string().optional(), nickname: z.string().optional() }
ItemStartedNotificationSchema.params += { childThreadId: z.string().optional(), nickname: z.string().optional() }
ItemDeltaNotificationSchema.params += { childThreadId: z.string().optional(), nickname: z.string().optional() }
ItemCompletedNotificationSchema.params += { childThreadId: z.string().optional(), nickname: z.string().optional() }
```

#### 3c. interaction 이벤트 추가

```typescript
// agent/types.ts
| {
    type: "collab_interaction_begin";
    callId: string;
    receiverThreadId: string;
    receiverNickname?: string;
    prompt: string;
  }
| {
    type: "collab_interaction_end";
    callId: string;
    receiverThreadId: string;
    receiverNickname?: string;
    prompt: string;
    status: CollabAgentStatus;
  }

// methods.ts
COLLAB_INTERACTION_BEGIN: "collab/interaction/begin",
COLLAB_INTERACTION_END: "collab/interaction/end",

// server-notifications.ts
CollabInteractionBeginNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_INTERACTION_BEGIN),
  params: z.object({
    threadId: z.string(),
    callId: z.string(),
    receiverThreadId: z.string(),
    receiverNickname: z.string().optional(),
    prompt: z.string(),
  }),
});
CollabInteractionEndNotificationSchema = z.object({
  method: z.literal(DILIGENT_SERVER_NOTIFICATION_METHODS.COLLAB_INTERACTION_END),
  params: z.object({
    threadId: z.string(),
    callId: z.string(),
    receiverThreadId: z.string(),
    receiverNickname: z.string().optional(),
    prompt: z.string(),
    status: CollabAgentStatusSchema,
  }),
});
```

**Verify:** `bun run check`

### Task 4: Server 및 Adapter 업데이트

**Files:** `packages/core/src/app-server/server.ts`, `packages/core/src/notification-adapter.ts`

#### 4a. server.ts emitFromAgentEvent

- `collab_tool_start/end`, `collab_turn_start` case 제거
- `turn_start` case: `childThreadId` 있으면 TURN_STARTED notification 발송
- `tool_start/end` case: params에 `...(event.childThreadId ? { childThreadId, nickname } : {})` spread
- `collab_interaction_begin/end` case 추가
- 기존 collab boundary events에서 agentId → childThreadId
- `restoreAgent(agentId, nickname)` → `restoreAgent(threadId, nickname)`

#### 4b. notification-adapter.ts

- 3개 collab case 제거
- TURN_STARTED, ITEM_* handler에서 childThreadId/nickname passthrough
- interaction notification ↔ AgentEvent 변환 추가
- 기존 collab boundary case에서 agentId → childThreadId

**Verify:** `bun test`

### Task 5: Session persistence 업데이트

**Files:** `packages/core/src/session/types.ts`, `packages/core/src/session/manager.ts`, `packages/core/src/session/persistence.ts`

- CollabSessionMeta에서 agentId 제거
- SessionHeader에서 agentId 제거
- `getHistoricalCollabAgents()`: spawn_agent tool result에서 `thread_id` 파싱 (기존 `agent_id` fallback 유지)
- DeferredWriter: collabMeta 직렬화에서 agentId 제거

**Verify:** `bun test packages/core/test/`

### Task 6: Web UI 업데이트

**Files:** `packages/web/src/client/lib/thread-store.ts`, `packages/web/src/client/components/CollabEventBlock.tsx`

#### 6a. thread-store.ts reducer

- RenderItem collab variant: `agentId` → `childThreadId`
- `collab_tool_start/end`, `collab_turn_start` case 제거
- `tool_start` case: `childThreadId` 체크 → spawn item의 childTools에 추가
- `tool_end` case: `childThreadId` 체크 → spawn item의 childTools 업데이트
- `turn_start` case: `childThreadId` 체크 → spawn item의 turnNumber 업데이트
- `collab_interaction_end` case 추가 → eventType "interaction" RenderItem 생성
- `eventType` 확장: `"spawn" | "wait" | "close" | "interaction"`
- spawn_agent output 파싱: `agent_id` → `thread_id` (fallback 유지)

#### 6b. CollabEventBlock.tsx

```typescript
case "interaction":
  icon = "→";
  title = `Sent message to ${agentLabel}`;
  // prompt를 expandable content로 표시
```

**Verify:** Web UI에서 collab 시나리오 수동 테스트

### Task 7: TUI 업데이트

**Files:** `packages/cli/src/tui/components/chat-view.ts`

- Collab boundary event 렌더링에서 `agentId` → `childThreadId`
- Inline display: `• Spawned Oak [general]` — 변경 없음 (nickname 사용)

**Verify:** TUI에서 collab 시나리오 수동 테스트

### Task 8: 테스트 업데이트

**Files:** 모든 collab 테스트 + web 테스트

- `agentId` → `threadId`/`childThreadId` 리네이밍
- `collab_tool_*` 검증 → `tool_start/end` with `childThreadId` 검증
- interaction begin/end 이벤트 검증 추가
- spawn 반환값 `agent_id` → `thread_id` 검증

**Verify:** `bun test` 전체 통과

## Acceptance Criteria

1. `bun test` — 모든 테스트 통과
2. `agentId` 필드가 collab 관련 코드에서 완전 제거 (threadId/childThreadId로 대체)
3. `nextId()` 시퀀셜 ID 생성 제거, child sessionId를 직접 사용
4. `COLLAB_TOOL_START/END`, `COLLAB_TURN_START` 코드에서 완전 제거
5. Child agent 도구 호출이 `ITEM_STARTED/COMPLETED` + `childThreadId`로 전달
6. `send_input` 호출 시 `collab_interaction_begin/end` 이벤트 발생
7. Web UI에서 child agent 도구가 spawn item 하위에 표시
8. Web UI에서 interaction 이벤트가 블록으로 표시
9. No `any` type escape hatches

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | registry가 tool_start+childThreadId를 emit | `bun test packages/core/test/collab/registry.test.ts` |
| Unit | spawn이 threadId(= sessionId)를 반환 | `bun test packages/core/test/collab/` |
| Unit | sendInput이 interaction begin/end를 emit | `bun test packages/core/test/collab/` |
| Unit | thread-store가 childThreadId 있는 tool event를 spawn item에 중첩 | `bun test packages/web/test/thread-store.test.ts` |
| Integration | spawn → tool calls → send_input → wait 전체 흐름 | `bun test packages/core/test/collab/integration.test.ts` |
| Manual | Web UI에서 multi-agent 시나리오 실행 | 실제 agent 실행 후 UI 확인 |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Protocol breaking change | 외부 consumer 없음 (내부 프로토콜) | 영향 없음 |
| 기존 session 파일 호환성 | agentId가 SessionHeader에 저장된 기존 세션 | fallback 파싱 유지 (agent_id → thread_id) |
| LLM tool param 변경 | spawn이 agent_id → thread_id 반환 | LLM은 tool output 스키마를 자동 적응 |
| TUI collab 렌더링 | boundary event의 필드명 변경 | 단순 리네이밍이므로 저위험 |
| childThreadId vs threadId 혼동 | notification params에 threadId(parent)와 childThreadId가 공존 | 이름으로 명확히 구분 |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D004 | Op/Event pattern — 15-20 core types | Task 3: 이벤트 수 관리 (3 제거 + 2 추가 = net -1) |
| D062 | Multi-agent child sessions | 전체: collab 아키텍처 기반 |
| D086 | Protocol evolution principles | Task 3: notification schema 변경 |
