# Codex-RS V2 호환 프로토콜 타입 정의

## Context

Diligent에 appserver를 추가하기 위한 첫 단계로, codex-rs v2 프로토콜과 호환되는 TypeScript 타입을 정의한다. 서버 구현이나 transport 없이 **타입만** 정의하며, 이 타입이 향후 appserver ↔ client (Web UI, TUI) 간의 계약이 된다.

Codex-rs v2는 thread/turn 모델을 사용하며, JSON-RPC 2.0 (lite) 위에 4방향 메시지 흐름을 갖는다:
- ClientRequest (client→server, 응답 기대)
- ClientNotification (client→server, 응답 없음)
- ServerNotification (server→client, 응답 없음)
- ServerRequest (server→client, 응답 기대 — 승인 흐름)

## 파일 구조

```
packages/core/src/protocol/
  README.md                    # 디렉토리 네비게이션
  index.ts                     # 통합 re-export (v2 + ext)
  jsonrpc.ts                   # 공통 — JSON-RPC envelope 타입
  methods.ts                   # 공통 — v2 + ext 메서드 문자열 상수
  v2/                          # ← codex-rs v2 호환 (순수 wire format)
    index.ts                   #   v2 re-exports
    data-model.ts              #   Thread, Turn, ThreadItem, UserInput, 상태
    client-requests.ts         #   Client→Server 요청 params/response
    server-notifications.ts    #   Server→Client 알림 payload
    server-requests.ts         #   Server→Client 요청 (승인 흐름)
  ext/                         # ← diligent 고유 확장
    index.ts                   #   ext re-exports
    data-model.ts              #   Knowledge, ModeKind, PlanChecklist, CollabAgentState
    client-requests.ts         #   auth/status, knowledge/list, auth/login/start
    server-notifications.ts    #   knowledge_saved, loop_detected, steering_injected
  __tests__/
    data-model.test.ts         # v2 ThreadItem 등 discriminated union 검증
    jsonrpc.test.ts            # envelope parse/reject 검증
    ext-data-model.test.ts     # ext 타입 검증
```

### 분리 원칙

- **`v2/`**: codex-rs v2와 호환되는 타입. 유사한 개념이 codex에 있으면 codex wire format에 맞춤
  - CollaborationMode (diligent의 ModeKind에 대응)
  - account/login (diligent의 OAuth에 대응)
  - ThreadItem.plan + item/plan/delta (diligent의 plan tool에 대응)
  - collab/* 이벤트 (diligent의 spawn/wait/send/close에 대응)
- **`ext/`**: codex에 아예 없는 diligent 고유 개념만
  - Knowledge (save/inject/rank — codex에 없음)
  - Loop detection (codex에 없음)
  - Steering injected (codex에 없음)
- **`jsonrpc.ts`, `methods.ts`**: 양쪽 다 사용하는 공통 인프라. methods.ts에서 `V2_CLIENT_METHODS` / `V2_SERVER_NOTIFICATION_METHODS`와 `EXT_CLIENT_METHODS` / `EXT_SERVER_NOTIFICATION_METHODS`를 각각 export

## 포함/제외 범위

**포함 (diligent에 필요한 것):**
- JSON-RPC envelope (Request, Notification, Response, Error)
- Thread 생명주기: start, resume, fork, archive, unarchive, list, read, rollback, compact/start
- Turn 생명주기: start, steer, interrupt
- Config: read, value/write, batchWrite
- Model: list
- Skills: list
- MCP server status: list (L9 미래 대비)
- Auth: login (OAuth 흐름 시작/완료), status 확인 — ChatGPT OAuth(D088-D090) 이미 구현됨
- Server notifications: thread/turn/item 스트리밍 + collab agent 이벤트
- Server requests: 승인 흐름 (commandExecution, fileChange, userInput)

**제외 (codex-rs 전용 / 불필요):**
- Realtime audio/voice
- Windows sandbox
- Fuzzy file search
- Remote skills (Hazelnut — OpenAI 내부)
- Apps list
- Review mode
- v1 deprecated API 전체
- Account rate-limits
- ChatGPT-specific auth token refresh (server→client 패턴, diligent은 클라이언트 내부에서 처리)

## 구현 상세

### 1. `jsonrpc.ts` — JSON-RPC envelope

Zod 스키마 + 추론 타입. codex-rs처럼 `"jsonrpc": "2.0"` 필드 없는 lite 버전.

```typescript
RequestIdSchema = z.union([z.string(), z.number().int()])
JSONRPCRequestSchema = z.object({ id, method, params? })
JSONRPCNotificationSchema = z.object({ method, params? })
JSONRPCResponseSchema = z.object({ id, result })
JSONRPCErrorSchema = z.object({ id, error: { code, message, data? } })
```

### 2. `methods.ts` — 메서드 문자열 상수

```typescript
// codex v2 호환
V2_CLIENT_METHODS = { THREAD_START: "thread/start", TURN_START: "turn/start", ... } as const
V2_SERVER_NOTIFICATION_METHODS = { TURN_STARTED: "turn/started", ITEM_STARTED: "item/started", ... } as const
V2_SERVER_REQUEST_METHODS = { COMMAND_EXECUTION_REQUEST_APPROVAL: "item/commandExecution/requestApproval", ... } as const

// diligent 고유 확장
EXT_CLIENT_METHODS = { KNOWLEDGE_LIST: "knowledge/list" } as const
EXT_SERVER_NOTIFICATION_METHODS = { KNOWLEDGE_SAVED: "knowledge/saved", LOOP_DETECTED: "loop/detected" } as const
```

### 3. `data-model.ts` — 핵심 도메인 타입

codex-rs v2 wire format 그대로 camelCase. 주요 타입:

- **ThreadStatus**: `notLoaded | idle | systemError | active { activeFlags }`
- **TurnStatus**: `completed | interrupted | failed | inProgress`
- **CollaborationMode**: `default | plan | execute` (codex의 CollaborationMode에 대응, diligent의 ModeKind 매핑)
- **UserInput**: discriminated union — `text | image | localImage | skill | mention`
- **ThreadItem**: discriminated union — `userMessage | agentMessage | plan | reasoning | commandExecution | fileChange | mcpToolCall | collabAgentToolCall | contextCompaction`
- **CollabAgentToolCall 관련**: `CollabAgentTool`, `CollabAgentState`, `CollabAgentToolCallStatus`
- **Turn**: `{ id, items: ThreadItem[], status, error? }`
- **Thread**: `{ id, preview, modelProvider, createdAt, updatedAt, status, cwd, name?, turns }`
- **TokenUsage**: `{ total, last, modelContextWindow? }`
- **TurnError**: `{ message, codexErrorInfo?, additionalDetails? }`
- **CodexErrorInfo**: discriminated union — `contextWindowExceeded | usageLimitExceeded | serverOverloaded | unauthorized | ...`
- **AuthProvider**: `{ provider, method, authenticated, expiresAt? }` (codex의 account/login 패턴에 맞춤)

### 4. `client-requests.ts` — 클라이언트 요청

각 메서드마다 `*Params` + `*Response` Zod 스키마 쌍:

| 메서드 | Params 핵심 필드 | Response 핵심 필드 |
|--------|------------------|-------------------|
| thread/start | model?, cwd?, instructions? | thread, model, cwd |
| thread/resume | threadId, model? | thread (with turns) |
| thread/fork | threadId, model? | thread |
| thread/archive | threadId | threadId |
| thread/unarchive | threadId | threadId |
| thread/name/set | threadId, name | {} |
| thread/compact/start | threadId | {} |
| thread/rollback | threadId, turnId | {} |
| thread/list | cursor?, limit?, archived? | data: Thread[], nextCursor? |
| thread/read | threadId, includeTurns? | thread |
| turn/start | threadId, input: UserInput[], model?, mode? | turn |
| turn/steer | threadId, input, expectedTurnId | turnId |
| turn/interrupt | threadId, turnId | {} |
| config/read | includeLayers? | config |
| config/value/write | keyPath, value | status |
| config/batchWrite | edits[] | status |
| model/list | cursor?, limit? | data: ModelInfo[] |
| skills/list | cwds?, forceReload? | data: SkillMetadata[] |
| mcpServerStatus/list | {} | data: McpServerStatus[] |
| collaborationMode/list | {} | data: CollaborationMode[] |
| account/login/start | provider, method | loginUrl?, callbackPort? |
| account/login/complete | provider, code? | success |
| account/read | {} | providers: AuthProvider[] |

### 5. `server-notifications.ts` — 서버 알림

| 메서드 | Payload 핵심 필드 |
|--------|------------------|
| error | error: TurnError, willRetry, threadId, turnId |
| thread/started | thread |
| thread/status/changed | threadId, status |
| thread/tokenUsage/updated | threadId, turnId, tokenUsage |
| turn/started | threadId, turn |
| turn/completed | threadId, turn |
| item/started | threadId, turnId, item: ThreadItem |
| item/completed | threadId, turnId, item: ThreadItem |
| item/agentMessage/delta | threadId, turnId, itemId, delta |
| item/commandExecution/outputDelta | threadId, turnId, itemId, delta |
| item/fileChange/outputDelta | threadId, turnId, itemId, delta |
| item/reasoning/summaryTextDelta | threadId, turnId, itemId, delta, summaryIndex |
| thread/compacted | threadId, turnId |
| model/rerouted | threadId, from, to, reason |
| item/plan/delta | threadId, turnId, itemId, delta |
| collab/agent/spawn/begin | threadId, turnId, agentId, nickname, agentType |
| collab/agent/spawn/end | threadId, turnId, agentId, status |
| collab/agent/interaction/begin | threadId, turnId, agentId |
| collab/agent/interaction/end | threadId, turnId, agentId, result |
| collab/waiting/begin | threadId, turnId, agentIds |
| collab/waiting/end | threadId, turnId, agentIds |
| account/login/completed | provider, success |
| turn/steered | threadId, turnId, messageCount |

### 6. `server-requests.ts` — 승인 흐름

L4 Approval이 구현되면 사용할 타입. 지금은 타입만 정의:

- **CommandExecutionRequestApproval**: params(threadId, turnId, itemId, command?, cwd?, reason?) → response(decision)
- **FileChangeRequestApproval**: params(threadId, turnId, itemId, reason?) → response(decision)
- **ToolRequestUserInput**: params(threadId, turnId, itemId, questions[]) → response(answers)

승인 결정 타입:
- `CommandExecutionApprovalDecision`: `accept | acceptForSession | decline | cancel`
- `FileChangeApprovalDecision`: `accept | acceptForSession | decline | cancel`

### 7. `ext/data-model.ts` — Diligent 고유 데이터 모델 (codex에 없는 것만)

```typescript
- KnowledgeEntry: { id, content, type, score?, createdAt }
```

### 8. `ext/client-requests.ts` — Diligent 고유 요청

| 메서드 | Params | Response |
|--------|--------|----------|
| knowledge/list | threadId?, limit? | data: KnowledgeEntry[] |

### 9. `ext/server-notifications.ts` — Diligent 고유 알림

| 메서드 | Payload |
|--------|---------|
| knowledge/saved | threadId, entry: KnowledgeEntry |
| loop/detected | threadId, turnId, patternLength, toolName |

### 10. `index.ts` + core index.ts 업데이트

```typescript
// packages/core/src/protocol/index.ts
export * from "./jsonrpc";
export * from "./methods";
export * as v2 from "./v2/index";
export * as ext from "./ext/index";
```

`packages/core/src/index.ts`에 `// Protocol` 섹션 추가.

## Diligent 내부 타입과의 매핑 (참고용, 코드에 포함하지 않음)

| Diligent AgentEvent | Protocol Notification |
|---------------------|----------------------|
| turn_start | turn/started |
| turn_end | turn/completed |
| message_start | item/started (agentMessage) |
| message_delta | item/agentMessage/delta |
| message_end | item/completed (agentMessage) |
| tool_start | item/started (commandExecution/fileChange/mcpToolCall) |
| tool_update | item/commandExecution/outputDelta |
| tool_end | item/completed (commandExecution/fileChange/mcpToolCall) |
| status_change | thread/status/changed |
| usage | thread/tokenUsage/updated |
| error | error |
| compaction_* | thread/compacted + item/* (contextCompaction) |

추가 매핑 (v2에 유사 개념 있는 것):
| Diligent Internal | Protocol (v2) |
|---------------------|----------------------|
| spawn_agent tool_start | collab/agent/spawn/begin |
| spawn_agent tool_end | collab/agent/spawn/end |
| wait tool_start | collab/waiting/begin |
| wait tool_end | collab/waiting/end |
| plan tool output | item/plan/delta |
| steering_injected | turn/steered |
| ModeKind | CollaborationMode |
| OAuth login | account/login/start → account/login/completed |

이 매핑은 향후 appserver adapter에서 구현한다.

## 컨벤션

- Zod 스키마: `const FooSchema = z.object(...)`, 타입: `type Foo = z.infer<typeof FooSchema>`
- Wire format은 camelCase (codex-rs v2와 동일)
- `@summary` 주석 각 파일 첫 줄
- 기존 패턴 참조: `packages/core/src/config/schema.ts`

## 구현 순서

1. `jsonrpc.ts` (의존성 없음)
2. `methods.ts` (의존성 없음)
3. `v2/data-model.ts` (zod만 의존)
4. `v2/client-requests.ts` (v2/data-model 의존)
5. `v2/server-notifications.ts` (v2/data-model 의존)
6. `v2/server-requests.ts` (v2/data-model 의존)
7. `v2/index.ts`
8. `ext/data-model.ts` (v2/data-model 의존 가능)
9. `ext/client-requests.ts` (ext/data-model 의존)
10. `ext/server-notifications.ts` (ext/data-model 의존)
11. `ext/index.ts`
12. `protocol/index.ts` + `core/src/index.ts` 업데이트
13. `README.md`
14. `__tests__/data-model.test.ts`, `__tests__/jsonrpc.test.ts`, `__tests__/ext-data-model.test.ts`

## 검증

```bash
bun run typecheck    # 타입 오류 없음
bun run lint         # lint 통과
bun test             # 기존 + 새 테스트 통과
```
