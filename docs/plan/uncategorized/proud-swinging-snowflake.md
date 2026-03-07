# P039: Meaningful E2E Tests — Protocol-Level Coverage

## Context

기존 e2e 테스트(`packages/e2e/conversation.test.ts`)는 `agentLoop()`를 직접 호출하는 5개 테스트뿐이다. **DiligentAppServer**라는 프로토콜 경계를 전혀 거치지 않아, 실제 사용자 워크플로우(JSON-RPC 핸드셰이크, 세션 CRUD, 노티피케이션 스트리밍, 멀티커넥션 팬아웃)에서 발생할 수 있는 리그레션을 잡지 못한다.

**목표**: Mock 스트림 기반의 프로토콜 레벨 e2e 테스트를 추가하여, API 키 없이도 핵심 서버 워크플로우를 검증한다. 기존 라이브 API 테스트는 그대로 유지.

## File Structure

```
packages/e2e/
  helpers/
    fake-stream.ts          -- 설정 가능한 fake StreamFunction 팩토리
    protocol-client.ts      -- RpcClientSession 기반 테스트 클라이언트
    server-factory.ts       -- createTestServer() 팩토리
  protocol-lifecycle.test.ts   -- 핸드셰이크, 스레드 CRUD
  turn-execution.test.ts       -- 턴 실행, 이벤트 시퀀스, 세션 퍼시스턴스
  session-resume.test.ts       -- 세션 리줌, 리스트, 삭제
  mode-and-config.test.ts      -- 모드 전환, effort, 툴 필터링
  multi-connection.test.ts     -- 구독 팬아웃, 멀티 피어
  conversation.test.ts         -- [기존 유지 — 변경 없음]
```

## Task 1: Test Helpers

### 1-1. `helpers/fake-stream.ts`

`EventStream` 기반으로 결정론적 스트림 팩토리를 구현한다.

```ts
// 단순 텍스트 응답
createSimpleStream(text: string): StreamFunction

// 툴 호출 → 최종 텍스트 응답 (호출 횟수별 다른 응답)
createToolUseStream(toolCalls: ToolCallSpec[], finalText: string): StreamFunction

// 느린 스트림 (interrupt 테스트용, 각 delta에 delay)
createSlowStream(text: string, delayMs: number): StreamFunction
```

각 팩토리는 `queueMicrotask`로 이벤트를 push하여 실제 비동기 동작을 모사한다.

**참고 구현**: `packages/web/test/rpc-bridge.test.ts:64-85`의 인라인 `streamFunction`

### 1-2. `helpers/protocol-client.ts`

`RpcClientSession`(`packages/core/src/rpc/client.ts`)을 래핑하는 테스트 클라이언트:

```ts
interface ProtocolTestClient {
  request<M>(method: M, params): Promise<Result<M>>;
  notifications: DiligentServerNotification[];
  waitForNotification(method: string, timeout?: number): Promise<...>;
  initAndStartThread(cwd: string): Promise<string>; // initialize + thread/start
  sendTurnAndWait(threadId: string, message: string): Promise<Notification[]>;
  onServerRequest(handler): void;
  close(): void;
}
```

내부에서 `createFakePeer()` + `server.connect()` + `RpcClientSession`을 조합한다.

### 1-3. `helpers/server-factory.ts`

```ts
function createTestServer(opts: {
  cwd: string;
  streamFunction?: StreamFunction;
  tools?: Tool[];
}): DiligentAppServer
```

`rpc-bridge.test.ts:52-90`의 `createMinimalServer()`를 일반화.

## Task 2: `protocol-lifecycle.test.ts`

Mock 스트림만 사용. API 키 불필요.

| 테스트 | 검증 내용 |
|--------|-----------|
| initialize 정상 응답 | serverName, protocolVersion, capabilities 반환 |
| thread/start → threadId 반환 + THREAD_STARTED 노티 | 세션 ID 패턴 `/^\d{14}-[0-9a-f]{6}$/` |
| thread/list → 생성된 스레드 포함 | 3개 스레드 생성 후 리스트 확인 |
| thread/read → 빈 컨텍스트 | 새 스레드의 messages 빈 배열 |
| thread/delete → 리스트에서 제거 | 삭제 후 thread/list에서 사라짐 |
| 잘못된 method → -32601 에러 | 존재하지 않는 method 전송 |
| 잘못된 params → -32602 에러 | 필수 파라미터 누락 |

## Task 3: `turn-execution.test.ts`

Mock 스트림만 사용.

| 테스트 | 검증 내용 |
|--------|-----------|
| 텍스트 턴 → 노티피케이션 시퀀스 정확 | status→busy, turn/started, item/started(user), item/completed(user), item/started(agent), item/delta, item/completed(agent), turn/completed, status→idle |
| 툴 사용 턴 → tool item 노티 포함 | item/started(toolCall) + item/completed(toolCall) 확인 |
| 실행 중 duplicate turn/start → 에러 | "A turn is already running" 에러 |
| 턴 완료 후 thread/read → 메시지 퍼시스트 | user + assistant 메시지 존재 |
| 멀티턴 → 컨텍스트 누적 | 2턴 후 thread/read에 4개 메시지 |

## Task 4: `session-resume.test.ts`

Mock 스트림만 사용. 서버 재시작을 시뮬레이션.

| 테스트 | 검증 내용 |
|--------|-----------|
| thread/resume by threadId → 컨텍스트 복원 | 새 서버 인스턴스에서 resume, found:true + messages |
| thread/resume mostRecent → 최근 스레드 | 2개 스레드 중 최근 것 반환 |
| 존재하지 않는 threadId → found:false | 에러 없이 not-found 반환 |
| thread/list → firstUserMessage 프리뷰 | 턴 후 리스트에 프리뷰 포함 |

## Task 5: `mode-and-config.test.ts`

Mock 스트림만 사용.

| 테스트 | 검증 내용 |
|--------|-----------|
| mode/set → plan 모드 전환 | 응답에 mode: "plan" |
| effort/set → effort 변경 | 응답에 effort: "max" |
| plan 모드 → buildAgentConfig에 mode 전달 | streamFunction에 전달된 config 확인 |

## Task 6: `multi-connection.test.ts`

Mock 스트림만 사용. `rpc-bridge.test.ts` 패턴 확장.

| 테스트 | 검증 내용 |
|--------|-----------|
| 구독 피어 모두 노티 수신 | 2 피어 subscribe → 둘 다 turn/started 수신 |
| unsubscribe 후 노티 미수신 | 해제 피어는 새 턴 노티 안 받음 |
| disconnect → 에러 없이 정리 | 연결 끊기 후 서버 정상 작동 |

## Implementation Order

1. **helpers/** (fake-stream → server-factory → protocol-client)
2. **protocol-lifecycle.test.ts** — 헬퍼 검증 겸 기반 테스트
3. **turn-execution.test.ts** — 핵심 워크플로우
4. **session-resume.test.ts** — 퍼시스턴스
5. **mode-and-config.test.ts** — 모드/설정
6. **multi-connection.test.ts** — 팬아웃

## Key Files to Modify/Reference

| 파일 | 역할 |
|------|------|
| `packages/e2e/package.json` | `@diligent/protocol` 의존성 추가 |
| `packages/core/src/app-server/server.ts` | 테스트 대상 — connect(), handleRequest() |
| `packages/core/src/rpc/client.ts` | RpcClientSession — 테스트 클라이언트 기반 |
| `packages/core/src/event-stream.ts` | EventStream — fake stream 구현 기반 |
| `packages/web/test/rpc-bridge.test.ts` | 기존 createFakePeer, createMinimalServer 참조 |
| `packages/core/src/tools/bash.ts` | 툴 테스트용 참조 |

## Verification

```bash
# 모든 mock 기반 e2e 테스트 (API 키 불필요)
bun test packages/e2e/ --exclude '**/conversation*'

# 기존 라이브 API 테스트 포함
ANTHROPIC_API_KEY=... DILIGENT_RUN_LIVE_E2E=1 bun test packages/e2e/

# 전체 테스트 스위트
bun test
```
