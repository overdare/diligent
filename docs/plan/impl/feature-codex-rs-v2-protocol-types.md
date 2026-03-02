# Codex-RS V2 100% Wire Format 호환 프로토콜 타입 정의

## Context

Diligent에 appserver를 추가하기 위한 첫 단계로, codex-rs v2 프로토콜과 **100% wire format 호환**되는 TypeScript Zod 스키마를 정의한다. 서버 구현이나 transport 없이 **타입만** 정의하며, 이 타입이 향후 appserver ↔ client (Web UI, TUI) 간의 계약이 된다.

Codex-rs v2는 thread/turn 모델을 사용하며, JSON-RPC 2.0 (lite) 위에 4방향 메시지 흐름을 갖는다:
- ClientRequest (client→server, 응답 기대)
- ClientNotification (client→server, 응답 없음)
- ServerNotification (server→client, 응답 없음)
- ServerRequest (server→client, 응답 기대 — 승인 흐름)

### 방향 전환

기존 문서는 codex-rs v2의 일부만 선택적으로 정의했다. 이번 계획은 **100% wire format 호환**으로 방향을 전환한다. Codex-rs v2의 모든 ClientRequest, ClientNotification, ServerNotification, ServerRequest와 전체 데이터 모델을 TypeScript Zod 스키마로 정의한다.

Diligent가 아직 구현하지 않은 기능(review mode, Windows sandbox, fuzzy file search, apps 등)도 **타입은 완전하게 포함**하되, 런타임 구현은 하지 않는다. 이를 통해:
- Codex 호환 클라이언트가 Diligent appserver에 연결했을 때 스키마 불일치 없음
- 향후 기능 추가 시 타입 변경 불필요
- 소스 코드에서 codex-rs v2 wire format을 직접 확인할 수 있는 단일 참조점 확보

문서를 내부 4-Phase로 분할하여 독립 구현/검증 가능하게 한다.

## 소스 참조

| 소스 | 파일 | 용도 |
|------|------|------|
| v2 전체 타입 | `docs/references/codex/codex-rs/app-server-protocol/src/protocol/v2.rs` (4047줄) | 모든 struct/enum/Params/Response |
| 메서드 라우팅 | `docs/references/codex/codex-rs/app-server-protocol/src/protocol/common.rs` | v2 wire 메서드명, 실험적 기능 게이팅 |
| JSON-RPC envelope | `docs/references/codex/codex-rs/app-server-protocol/src/jsonrpc_lite.rs` | lite envelope 구조 |
| Zod 컨벤션 | `packages/core/src/config/schema.ts` | `const FooSchema = z.object(...)` 패턴 |

## 파일 구조

```
packages/core/src/protocol/
  README.md
  index.ts                          # 통합 re-export
  jsonrpc.ts                        # JSON-RPC lite envelope
  v2/
    index.ts
    methods.ts                      # 모든 v2 메서드 상수
    data-model.ts                   # Thread, Turn, ThreadItem(13), UserInput(5), 모든 enum
    client-requests.ts              # ClientRequest Params/Response 쌍
    client-notifications.ts         # Initialized
    server-notifications.ts         # ServerNotification payload
    server-requests.ts              # ServerRequest Params/Response 쌍
  ext/
    index.ts
    methods.ts                      # diligent 고유 메서드 상수
    data-model.ts                   # KnowledgeEntry
    client-requests.ts              # knowledge/list
    server-notifications.ts         # knowledge/saved, loop/detected
  __tests__/
    jsonrpc.test.ts
    data-model.test.ts
    client-requests.test.ts
    server-notifications.test.ts
    server-requests.test.ts
    ext-data-model.test.ts
```

기존 계획과 달리 `methods.ts`를 `v2/`와 `ext/` 각각에 배치하여 import 방향을 깔끔하게 유지한다.

### 분리 원칙

- **`v2/`**: codex-rs v2 wire format과 1:1 호환. 모든 v2 메서드와 데이터 타입 포함
- **`ext/`**: codex에 아예 없는 diligent 고유 확장만 (knowledge, loop detection)
- **`jsonrpc.ts`**: v2와 ext 양쪽이 공유하는 JSON-RPC envelope

---

## Phase 1: Foundation — jsonrpc + methods + data-model

### 목표
프로토콜의 기반 타입 전체 정의. 이후 Phase의 모든 Params/Response가 이 타입을 import한다.

### 의존성
없음 (Zod만)

### 파일

**`jsonrpc.ts`** (~60줄)
- `RequestIdSchema` = `z.union([z.string(), z.number().int()])`
- `JSONRPCRequestSchema` = `z.object({ id, method, params? })`
- `JSONRPCNotificationSchema` = `z.object({ method, params? })`
- `JSONRPCResponseSchema` = `z.object({ id, result })`
- `JSONRPCErrorSchema` = `z.object({ id, error: { code, message, data? } })`
- `"jsonrpc": "2.0"` 필드 없음 (codex-rs lite 방식 — `jsonrpc_lite.rs` 참조)

**`v2/methods.ts`** (~120줄)

`V2_CLIENT_REQUEST_METHODS` — 전체:

| 그룹 | 메서드 |
|------|--------|
| Thread (12) | `thread/start`, `thread/resume`, `thread/fork`, `thread/archive`, `thread/unarchive`, `thread/name/set`, `thread/compact/start`, `thread/backgroundTerminals/clean`[EXP], `thread/rollback`, `thread/list`, `thread/loaded/list`, `thread/read` |
| Turn (3) | `turn/start`, `turn/steer`, `turn/interrupt` |
| Review (1) | `review/start` |
| Skills (4) | `skills/list`, `skills/remote/list`, `skills/remote/export`, `skills/config/write` |
| App (1) | `app/list` |
| Account (5) | `account/login/start`, `account/login/cancel`, `account/logout`, `account/rateLimits/read`, `account/read` |
| Config (4) | `config/read`, `config/value/write`, `config/batchWrite`, `configRequirements/read` |
| Model (1) | `model/list` |
| Feature (2) | `experimentalFeature/list`, `collaborationMode/list`[EXP] |
| MCP (3) | `mcpServer/oauth/login`, `config/mcpServer/reload`, `mcpServerStatus/list` |
| System (3) | `windowsSandbox/setupStart`, `command/exec`, `feedback/upload` |
| Test (1) | `mock/experimentalMethod`[EXP] |

`V2_CLIENT_NOTIFICATION_METHODS`:
- `{ INITIALIZED: "initialized" }`

`V2_SERVER_NOTIFICATION_METHODS` — 전체:

| 그룹 | 메서드 |
|------|--------|
| Error (1) | `error` |
| Thread (7) | `thread/started`, `thread/status/changed`, `thread/archived`, `thread/unarchived`, `thread/name/updated`, `thread/tokenUsage/updated`, `thread/compacted` |
| Turn (4) | `turn/started`, `turn/completed`, `turn/diff/updated`, `turn/plan/updated` |
| Item (3) | `item/started`, `item/completed`, `rawResponseItem/completed` |
| Delta (8) | `item/agentMessage/delta`, `item/plan/delta`, `item/commandExecution/outputDelta`, `item/fileChange/outputDelta`, `item/commandExecution/terminalInteraction`, `item/reasoning/textDelta`, `item/reasoning/summaryTextDelta`, `item/reasoning/summaryPartAdded` |
| MCP (2) | `item/mcpToolCall/progress`, `mcpServer/oauthLogin/completed` |
| Account (3) | `account/updated`, `account/rateLimits/updated`, `account/login/completed` |
| System (5) | `app/list/updated`, `fuzzyFileSearch/sessionUpdated`[EXP], `fuzzyFileSearch/sessionCompleted`[EXP], `windows/worldWritableWarning`, `windowsSandbox/setupCompleted` |
| Meta (3) | `model/rerouted`, `deprecationNotice`, `configWarning` |

`V2_SERVER_REQUEST_METHODS` — 5개:
- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/tool/requestUserInput` [EXP]
- `item/tool/call`
- `account/chatgptAuthTokens/refresh`

각각의 union type (`V2ClientRequestMethod` 등) export.

**`v2/data-model.ts`** (~800-1000줄, 가장 큰 파일)

모든 enum/union/struct:

| 카테고리 | 타입 | 변환 규칙 |
|----------|------|----------|
| Thread | `ThreadSchema`, `ThreadStatusSchema` (tag="type"), `ThreadActiveFlagSchema`, `TurnSchema`, `TurnStatusSchema`, `TurnErrorSchema` | camelCase |
| ThreadItem | `ThreadItemSchema` — 13 variants (tag="type"): userMessage, agentMessage, plan, reasoning, commandExecution, fileChange, mcpToolCall, collabAgentToolCall, webSearch, imageView, enteredReviewMode, exitedReviewMode, contextCompaction | camelCase |
| UserInput | `UserInputSchema` — 5 variants (tag="type"): text, image, localImage, skill, mention | camelCase |
| Status enums | `CommandExecutionStatusSchema`, `PatchApplyStatusSchema`, `McpToolCallStatusSchema`, `CollabAgentToolCallStatusSchema`, `CollabAgentStatusSchema` | camelCase |
| Collab | `CollabAgentToolSchema` (5값), `CollabAgentStateSchema` | camelCase |
| Error | `CodexErrorInfoSchema` — 13 variants (tag="type") | camelCase |
| Token | `TokenUsageBreakdownSchema`, `ThreadTokenUsageSchema` | camelCase |
| Approval | `AskForApprovalSchema`, `CommandExecutionApprovalDecisionSchema` (5값), `FileChangeApprovalDecisionSchema` (4값), `ExecPolicyAmendmentSchema` | **kebab-case** (AskForApproval만) |
| Sandbox | `SandboxPolicySchema` (tag="type", 4 variants), `ReadOnlyAccessSchema`, `NetworkAccessSchema` | camelCase |
| Config | `ConfigLayerSourceSchema` (tag="type"), `MergeStrategySchema`, `WriteStatusSchema`, `ConfigWriteErrorCodeSchema`, `ResidencyRequirementSchema` | camelCase |
| Review | `ReviewTargetSchema` (tag="type", 4 variants), `ReviewDeliverySchema` | camelCase |
| Account | `AuthModeSchema`, `SessionSourceSchema`, `McpAuthStatusSchema`, `ModelRerouteReasonSchema` | camelCase |
| Command | `CommandActionSchema` (tag="type"), `ParsedCommandSchema` | camelCase |
| WebSearch | `WebSearchActionSchema` (tag="type") | camelCase |
| Sub-types | `ByteRangeSchema`, `TextElementSchema`, `GitInfoSchema`, `FileUpdateChangeSchema`, `McpToolCallResultSchema`, `McpToolCallErrorSchema`, `CollaborationModeSchema`, `MessagePhaseSchema`, `DynamicToolSpecSchema`, `DynamicToolCallOutputContentItemSchema`, `TextPositionSchema`, `TextRangeSchema`, `NetworkApprovalContextSchema` | camelCase |
| Model/Skill | `ModelSchema`, `SkillMetadataSchema`, `SkillsListEntrySchema`, `ReasoningEffortOptionSchema` | camelCase |
| Rate Limits | `RateLimitSnapshotSchema`, `RateLimitWindowSchema`, `CreditsSnapshotSchema`, `PlanTypeSchema` | camelCase |

### Wire Format 핵심 규칙

1. **camelCase** — `#[serde(rename_all = "camelCase")]` → Zod 필드명이 곧 wire
2. **kebab-case 예외** — `AskForApproval`, `SandboxMode`: `z.enum(["untrusted", "on-failure", ...])` + reject는 별도 object
3. **discriminated union** — `#[serde(tag = "type")]` → `z.discriminatedUnion("type", [...])`
4. **optional** — `#[serde(skip_serializing_if)]` → `.optional()`
5. **PathBuf** → `z.string()`, **i64** → `z.number()`, **HashMap** → `z.record()`
6. **@experimental** — JSDoc `/** @experimental gate/name */`로 표기
7. **untagged enum** — `#[serde(untagged)]` → `z.union([...])` (예: `RequestId`, `CodexErrorInfo`)
8. **flatten** — `#[serde(flatten)]` → 해당 필드를 부모 object에 spread

### 검증
```bash
bun run typecheck && bun run lint
```

---

## Phase 2: Protocol Surface — requests + notifications

### 목표
4방향 메시지의 모든 Params/Response 쌍과 notification payload를 정의한다.

### 의존성
Phase 1

### 파일

**`v2/client-requests.ts`** (~600-800줄):

| 그룹 | 메서드 | Params 핵심 필드 | Response 핵심 필드 |
|------|--------|------------------|-------------------|
| Thread | thread/start | model?, cwd?, instructions?, sandboxPolicy? | thread, model, cwd |
| | thread/resume | threadId, model? | thread (with turns) |
| | thread/fork | threadId, model? | thread |
| | thread/archive | threadId | threadId |
| | thread/unarchive | threadId | threadId |
| | thread/name/set | threadId, name | {} |
| | thread/compact/start | threadId | {} |
| | thread/backgroundTerminals/clean[EXP] | threadId | {} |
| | thread/rollback | threadId, turnId | {} |
| | thread/list | cursor?, limit?, archived? | data: Thread[], nextCursor? |
| | thread/loaded/list | {} | data: Thread[] |
| | thread/read | threadId, includeTurns? | thread |
| Turn | turn/start | threadId, input: UserInput[], model?, collaborationMode? | turn |
| | turn/steer | threadId, input, expectedTurnId | turnId |
| | turn/interrupt | threadId, turnId | {} |
| Review | review/start | threadId, turnId?, target | review |
| Skills | skills/list | cwds?, forceReload?, perCwdExtraUserRoots? | data: SkillMetadata[] |
| | skills/remote/list | {} | data: SkillsListEntry[] |
| | skills/remote/export | skillName, config | {} |
| | skills/config/write | cwds, config | {} |
| App | app/list | {} | data: App[] |
| Account | account/login/start | {} | loginId, loginUrl?, callbackPort? |
| | account/login/cancel | loginId | {} |
| | account/logout | (void) | {} |
| | account/rateLimits/read | (void) | rateLimits |
| | account/read | {} | account |
| Config | config/read | includeLayers? | config |
| | config/value/write | keyPath, value | status |
| | config/batchWrite | edits[] | status |
| | configRequirements/read | (void) | requirements |
| Model | model/list | cursor?, limit? | data: Model[] |
| Feature | experimentalFeature/list | {} | data: ExperimentalFeature[] |
| | collaborationMode/list[EXP] | {} | data: CollaborationMode[] |
| MCP | mcpServer/oauth/login | serverId, serverUrl | {} |
| | config/mcpServer/reload | (void) | {} |
| | mcpServerStatus/list | {} | data: McpServerStatus[] |
| System | windowsSandbox/setupStart | {} | {} |
| | command/exec | command, cwd? | exitCode, stdout, stderr |
| | feedback/upload | threadId, feedback | {} |
| Test | mock/experimentalMethod[EXP] | input | output |

**`v2/client-notifications.ts`** (~15줄)
- `InitializedNotificationSchema = z.object({})`

**`v2/server-notifications.ts`** (~400-500줄):

| 그룹 | 메서드 | Payload 핵심 필드 |
|------|--------|------------------|
| Error | error | error, willRetry?, threadId?, turnId? |
| Thread | thread/started | thread |
| | thread/status/changed | threadId, status |
| | thread/archived | threadId |
| | thread/unarchived | threadId |
| | thread/name/updated | threadId, name |
| | thread/tokenUsage/updated | threadId, turnId, tokenUsage |
| | thread/compacted | threadId, turnId |
| Turn | turn/started | threadId, turn |
| | turn/completed | threadId, turn |
| | turn/diff/updated | threadId, turnId, diff |
| | turn/plan/updated | threadId, turnId, plan |
| Item | item/started | threadId, turnId, item: ThreadItem |
| | item/completed | threadId, turnId, item: ThreadItem |
| | rawResponseItem/completed | threadId, turnId, item |
| Delta | item/agentMessage/delta | threadId, turnId, itemId, delta |
| | item/plan/delta | threadId, turnId, itemId, delta |
| | item/commandExecution/outputDelta | threadId, turnId, itemId, delta |
| | item/fileChange/outputDelta | threadId, turnId, itemId, delta |
| | item/commandExecution/terminalInteraction | threadId, turnId, itemId, interaction |
| | item/reasoning/textDelta | threadId, turnId, itemId, delta |
| | item/reasoning/summaryTextDelta | threadId, turnId, itemId, delta, summaryIndex |
| | item/reasoning/summaryPartAdded | threadId, turnId, itemId, summaryIndex |
| MCP | item/mcpToolCall/progress | threadId, turnId, itemId, progress |
| | mcpServer/oauthLogin/completed | serverId, success, error? |
| Account | account/updated | account |
| | account/rateLimits/updated | rateLimits |
| | account/login/completed | loginId?, success, error? |
| System | app/list/updated | apps |
| | fuzzyFileSearch/sessionUpdated[EXP] | sessionId, results |
| | fuzzyFileSearch/sessionCompleted[EXP] | sessionId |
| | windows/worldWritableWarning | path |
| | windowsSandbox/setupCompleted | success, error? |
| Meta | model/rerouted | threadId, turnId, fromModel, toModel, reason |
| | deprecationNotice | summary, details? |
| | configWarning | summary, details?, path?, range? |

**`v2/server-requests.ts`** (~150-200줄) — 5개:

| 메서드 | Params 핵심 필드 | Response 핵심 필드 |
|--------|------------------|-------------------|
| item/commandExecution/requestApproval | threadId, turnId, itemId, command?, cwd?, commandActions?, proposedExecpolicyAmendment?, approvalId?, reason?, networkApprovalContext? | decision: CommandExecutionApprovalDecision |
| item/fileChange/requestApproval | threadId, turnId, itemId, reason?, grantRoot? | decision: FileChangeApprovalDecision |
| item/tool/requestUserInput[EXP] | threadId, turnId, itemId, questions[] | answers: Record<string, ToolRequestUserInputAnswer> |
| item/tool/call | threadId, turnId, callId, tool, arguments | contentItems[], success |
| account/chatgptAuthTokens/refresh | tokens | tokens |

승인 결정 타입:
- `CommandExecutionApprovalDecision`: `accept | reject | acceptForSession | rejectForSession | cancel`
- `FileChangeApprovalDecision`: `accept | reject | acceptForSession | cancel`

### 검증
```bash
bun run typecheck && bun run lint
```

---

## Phase 3: Extensions + Integration

### 목표
Diligent 고유 확장 + 모든 index.ts re-export + README + core 패키지 export 업데이트.

### 의존성
Phase 1 + 2

### 파일

**`ext/methods.ts`**
- `EXT_CLIENT_REQUEST_METHODS` — `{ KNOWLEDGE_LIST: "knowledge/list" }`
- `EXT_SERVER_NOTIFICATION_METHODS` — `{ KNOWLEDGE_SAVED: "knowledge/saved", LOOP_DETECTED: "loop/detected" }`

**`ext/data-model.ts`**
- `KnowledgeEntrySchema` (기존 `packages/core/src/knowledge/types.ts`의 KnowledgeEntry 참조)

**`ext/client-requests.ts`**

| 메서드 | Params | Response |
|--------|--------|----------|
| knowledge/list | threadId?, limit? | data: KnowledgeEntry[] |

**`ext/server-notifications.ts`**

| 메서드 | Payload |
|--------|---------|
| knowledge/saved | threadId, entry: KnowledgeEntry |
| loop/detected | threadId, turnId, patternLength, toolName |

**`ext/index.ts`**, **`v2/index.ts`**, **`protocol/index.ts`** — re-exports:

```typescript
// packages/core/src/protocol/index.ts
export * from "./jsonrpc";
export * as v2 from "./v2/index";
export * as ext from "./ext/index";
```

**`packages/core/src/index.ts`** 업데이트 — `export * as protocol from "./protocol/index"`

**`protocol/README.md`** — 디렉토리 네비게이션 (4+ nodes이므로 필수)

### 검증
```bash
bun run typecheck && bun run lint
```

---

## Phase 4: Test Suite

### 목표
모든 프로토콜 타입의 Zod parse/reject 검증.

### 의존성
Phase 1 + 2 + 3

### 파일 (6개, ~500-600줄 합계)

| 테스트 파일 | 검증 대상 |
|------------|----------|
| `jsonrpc.test.ts` | envelope parse/reject, "jsonrpc" 필드 없음 확인 |
| `data-model.test.ts` | ThreadItem 13 variants, UserInput 5 variants, ThreadStatus, CodexErrorInfo 13 variants, AskForApproval kebab-case, SandboxPolicy 4 variants, ReviewTarget, wire format snapshot |
| `client-requests.test.ts` | 주요 Params/Response parse (thread/start, turn/start, config/read, command/exec 등) |
| `server-notifications.test.ts` | error, item/started, agentMessage/delta, tokenUsage/updated, model/rerouted, experimental notifications |
| `server-requests.test.ts` | 5개 ServerRequest Params/Response, approval decision variants, DynamicToolCallOutputContentItem |
| `ext-data-model.test.ts` | KnowledgeEntry, knowledge/list response, loop/detected payload |

### 검증
```bash
bun test packages/core/src/protocol/
bun run typecheck
bun run lint
```

---

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
| steering_injected | turn/steered → turn/diff/updated |
| ModeKind | CollaborationMode |
| OAuth login | account/login/start → account/login/completed |

이 매핑은 향후 appserver adapter에서 구현한다.

---

## 컨벤션

- Zod 스키마: `const FooSchema = z.object(...)`, 타입: `type Foo = z.infer<typeof FooSchema>`
- Wire format은 camelCase (codex-rs v2와 동일, `#[serde(rename_all = "camelCase")]`)
- `@summary` 주석 각 파일 첫 줄
- 기존 패턴 참조: `packages/core/src/config/schema.ts`
- `@experimental` 메서드/타입: JSDoc `/** @experimental gate/name */`로 표기

---

## 기존 계획과의 차이점

| 항목 | 기존 (`feature-codex-rs-v2-protocol-types.md`) | 이번 계획 |
|------|-----------------------------------------------|----------|
| 범위 | 선택적 (review, Windows, fuzzy search, apps 제외) | **100% codex-rs v2 호환** |
| ClientNotification | 누락 | `Initialized` 포함 |
| methods.ts 위치 | `protocol/` root (`methods.ts` 단일 파일) | `v2/methods.ts` + `ext/methods.ts` 분리 |
| 테스트 | 3파일 | 6파일 (client-requests, server-notifications, server-requests 추가) |
| thread/name/updated | 누락 | 포함 |
| Experimental 표기 | 없음 | JSDoc `@experimental` 일관 적용 |
| Phase 분할 | 없음 (단일 구현 순서만 나열) | 4 Phase 독립 구현/검증 |
| ServerRequest 상세 | 3개 (approval 2 + userInput) | 5개 (+ DynamicToolCall, ChatgptAuthTokensRefresh) |
| Approval decision | 4값 (accept/acceptForSession/decline/cancel) | 5값 (accept/reject/acceptForSession/rejectForSession/cancel) — v2.rs 원본 반영 |
| Sub-types | 미상세 | DynamicToolCallOutputContentItem, TextPosition, TextRange, NetworkApprovalContext 등 추가 |

## 크기 추정

| 카테고리 | 예상 lines |
|----------|-----------|
| v2/ (7파일) | ~1,700-2,200 |
| ext/ (5파일) | ~100 |
| jsonrpc.ts + index.ts + README | ~90 |
| __tests__/ (6파일) | ~500-600 |
| **Total** | **~2,400-3,000** |
