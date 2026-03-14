---
id: P050
status: backlog
created: 2026-03-14
---
# Stateful Agent with Draining Queue

## Context

현재 core/agent 레이어는 stateless Agent wrapper + EventStream + config callback 패턴으로 되어 있다. 이 구조에는 3가지 문제가 있다:

1. **SessionManager가 loop를 중복 구현** — `loop.ts`의 `runLoop()`과 `manager.ts`의 `runSession()`이 거의 같은 로직
2. **Steering이 config callback으로 간접화** — `getSteeringMessages`, `hasPendingMessages`가 AgentRunOptions에 콜백으로 전달
3. **EventStream이 외부 API** — consumer가 `for await` + `.result()` + `.waitForInnerWork()` 조합을 사용해야 함

pi-mono의 패턴을 참고하여, Agent를 stateful class로 바꾸고 drainingQueue + subscribe 패턴을 도입한다.

## Decision

- **Compaction**: `onTurnEnd` hook on AgentConfig. Agent가 매 턴 끝에 호출, 반환된 messages로 교체
- **Agent factory**: Config mutation. Agent를 세션당 1개 유지, setter로 설정 변경, refreshConfig() 콜백으로 매 턴 갱신
- **Migration**: 한번에. backward-compat shim 없이 모든 consumer를 동시에 subscribe 패턴으로 변경

## Changes

### Phase 1: Core Agent Stateful (core layer)

#### `packages/core/src/agent/types.ts`
- `AgentRunOptions`에서 `getSteeringMessages`, `hasPendingMessages` 제거
- `AgentLoopConfig` 타입 제거 (Agent가 직접 모든 것을 보유)
- 추가:
  ```typescript
  export interface AgentPromptOptions {
    signal?: AbortSignal;
    reservePercent?: number;
    sessionId?: string;
    debugThreadId?: string;
    debugTurnId?: string;
  }
  export type AgentListener = (event: CoreAgentEvent) => void;
  ```

#### `packages/core/src/agent/agent.ts` (13줄 → ~150줄)
Stateful class로 변환:
- **State**: `steeringQueue: Message[]`, `listeners: Set<AgentListener>`, `abortController`, `runningPromise`
- **Public API**:
  - `subscribe(fn): () => void` — 이벤트 구독, unsubscribe 반환
  - `prompt(messages, opts): Promise<Message[]>` — 루프 시작, 완료 시 resolve
  - `steer(msg)` — steeringQueue에 push
  - `hasPendingMessages(): boolean`
  - `abort()` — abortController.abort()
  - `waitForIdle(): Promise<void>`
- **Config mutators**: `setModel()`, `setTools()`, `setSystemPrompt()`, `setEffort()`, `setFilterTool()`
- **Config hooks**:
  - `onTurnEnd?: (ctx: { messages: Message[], turnId: string }) => Promise<{ messages?: Message[] } | void>` — compaction 등 세션 레벨 로직 주입점
- **Internal**: `_runLoop()` — loop.ts의 `runLoop()` 로직을 흡수. 내부에서 `drainSteeringMessages()`로 큐 직접 drain

#### `packages/core/src/agent/loop.ts`
- **삭제**: `agentLoop()`, `runLoop()`, `drainSteering()` — Agent._runLoop()로 이동
- **유지 (helper로 export)**:
  - `streamAssistantResponse()` — 시그니처 변경: `EventStream` 파라미터 → `emit: (event: CoreAgentEvent) => void`
  - `executeToolCalls()` — 같은 변경
  - `createTurnRuntime()` — 같은 변경
  - `toolToDefinition()`, `calculateCost()`, `createEmptyAssistantMessage()`, `filterAllowedTools()`, `toSerializableError()` — 변경 없음

#### `packages/core/src/event-stream.ts`
- **변경 없음**. Provider 레벨에서 계속 사용 (`EventStream<ProviderEvent, ProviderResult>`)

### Phase 2: SessionManager Subscribe Pattern (runtime layer)

#### `packages/runtime/src/session/manager.ts` (932줄 → ~500줄)
- **삭제**: `runSession()` (중복 루프), `pendingMessages`, `drainPendingMessages()`, `buildLoopConfig()`
- **변경**: `run()` 반환타입 `EventStream` → `Promise<void>`
- **추가**: `subscribe(fn): () => void` — SessionManager 자체 이벤트 구독 (Agent 이벤트 + runtime 이벤트 릴레이)
- **새 흐름**:
  ```
  run(userMessage):
    1. repairEntries()
    2. appendMessageEntry(userMessage)
    3. buildSessionContext()
    4. resolveAgent() → refreshConfig() → setter로 적용
    5. shouldCompact? → performCompaction()
    6. agent.onTurnEnd = compaction + config refresh hook 설정
    7. unsub = agent.subscribe(event => persist + this.emit(event))
    8. await agent.prompt(context.messages, opts)
    9. unsub()
  ```
- **steer()**: `agent.steer(msg)` 직접 호출로 단순화
- **Agent factory 변경**: `SessionManagerConfig.agent`를 `Agent` 인스턴스 + `refreshConfig?: () => Partial<AgentConfig>` 패턴으로

### Phase 3: App Server + Collab Adaptation

#### `packages/runtime/src/app-server/server.ts`
- **삭제**: `consumeStream()` (for-await + result + waitForInnerWork)
- **추가**: `consumeTurn(runtime, runPromise, unsub, turnId)` — subscribe 기반
  ```
  consumeTurn():
    try { await runPromise; await manager.waitForWrites(); emit TURN_COMPLETED }
    catch { emit TURN_INTERRUPTED or ERROR }
    finally { unsub(); runtime.isRunning = false; emit idle }
  ```

#### `packages/runtime/src/app-server/thread-handlers.ts`
- `handleTurnStart` 변경:
  ```
  Before: stream = manager.run(msg); void consumeStream(stream)
  After:  unsub = manager.subscribe(event => emitFromAgentEvent()); promise = manager.run(msg); void consumeTurn(promise, unsub)
  ```

#### `packages/runtime/src/collab/registry.ts`
- `spawn()` 변경: `for await (event of stream)` → `childManager.subscribe(event => ...)` + `await childManager.run(msg)`

### Phase 4: Tests

- `packages/core/src/agent/__tests__/agent.test.ts` — `agent.run()` → `agent.subscribe()` + `agent.prompt()`
- `packages/core/test/agent-loop.test.ts` — agentLoop() 직접 호출 → Agent 인스턴스 사용
- `packages/runtime/src/session/__tests__/manager.test.ts` — EventStream → subscribe + Promise
- `packages/runtime/src/session/__tests__/steering.test.ts` — agent.steer() 직접 사용
- `packages/runtime/src/app-server/__tests__/server.test.ts` — consumeStream → consumeTurn
- `packages/e2e/conversation.test.ts` — stream.result() → subscribe + prompt

### Phase 5: Clean Up

- `packages/core/src/index.ts` — `agentLoop` export 제거
- `packages/runtime/src/index.ts` — EventStream re-export 유지 (provider용)
- `packages/cli/src/config.ts` — `AgentLoopFn` 타입 제거 또는 갱신

## Key Files

| File | Action |
|------|--------|
| `packages/core/src/agent/agent.ts` | Major rewrite: stateful Agent |
| `packages/core/src/agent/loop.ts` | Shrink: remove loop, keep helpers |
| `packages/core/src/agent/types.ts` | Remove callbacks, add new types |
| `packages/runtime/src/session/manager.ts` | Major rewrite: subscribe pattern |
| `packages/runtime/src/app-server/server.ts` | consumeStream → consumeTurn |
| `packages/runtime/src/app-server/thread-handlers.ts` | Stream → subscribe + promise |
| `packages/runtime/src/collab/registry.ts` | Stream → subscribe + promise |
| `packages/core/src/event-stream.ts` | No change (provider level) |

## Verification

1. `bun test` — 전체 테스트 통과
2. `bun run build` — 타입 에러 없음
3. `bun run lint` — lint 통과
4. TUI에서 대화 실행 → 이벤트 정상 수신, 메시지 렌더링
5. Steering 테스트: 대화 중 `/steer` → 큐 drain 후 정상 응답
6. Compaction 테스트: 긴 대화 후 자동 compaction 동작 확인
