# P029: Multi-Client Thread Subscription (Peer Model)

## Context

현재 RpcBridge는 thread당 1개 client만 notification을 받을 수 있는 single-owner 모델(`threadOwners: Map<threadId, sessionId>`). Web 환경에서 같은 세션을 여러 탭/디바이스에서 동시 관찰하거나 pair programming이 불가능함. codex-rs의 검증된 peer subscription 패턴을 채택하여 N:M multi-client 지원.

## Design

codex-rs 동일한 **순수 peer model**:
- 모든 subscriber 동등 (role 없음)
- notification → 모든 subscriber에게 fan-out
- server request (approval/input) → 모든 subscriber에게 broadcast, **first-responder wins**
- 늦은 응답은 무시 (pending request already resolved)

## Changes

### 1. Protocol — `packages/protocol/src/methods.ts`

```ts
// 추가
DILIGENT_CLIENT_REQUEST_METHODS에:
  THREAD_SUBSCRIBE: "thread/subscribe"
  THREAD_UNSUBSCRIBE: "thread/unsubscribe"
```

### 2. Protocol types — `packages/protocol/src/index.ts`

```ts
// thread/subscribe params & result
{ threadId: string } → { subscriptionId: string }

// thread/unsubscribe params & result
{ subscriptionId: string } → { ok: boolean }
```

### 3. RpcBridge — `packages/web/src/server/rpc-bridge.ts`

**Data structure 교체:**

```ts
// Before
private readonly threadOwners = new Map<string, string>();

// After
private readonly threadSubscribers = new Map<string, Set<string>>();
// threadId → Set<sessionId>

private readonly subscriptions = new Map<string, { threadId: string; sessionId: string }>();
// subscriptionId → { threadId, sessionId }  (for unsubscribe lookup)
```

**Auto-subscribe on thread/start, thread/resume:**
- 기존 `threadOwners.set()` → `threadSubscribers.get(threadId).add(sessionId)` + `subscriptions.set(subId, ...)`
- 이전 thread가 있으면 auto-unsubscribe하지 않음 (여러 thread 동시 구독 가능)

**routeNotification() 변경:**
```ts
// Before: send to single owner
// After: fan-out to all subscribers
private routeNotification(notification: DiligentServerNotification): void {
  const threadId = (notification.params as { threadId?: string }).threadId;
  if (!threadId) {
    this.broadcast({ type: "server_notification", notification });
    return;
  }
  const subscribers = this.threadSubscribers.get(threadId);
  if (!subscribers || subscribers.size === 0) {
    this.broadcast({ type: "server_notification", notification });
    return;
  }
  for (const sessionId of subscribers) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.send(session.ws, { type: "server_notification", notification });
    }
  }
}
```

**Server request handler 변경 (first-responder wins):**
```ts
// Before: find single owner, ask only that session
// After: broadcast to all subscribers, first response resolves the promise
this.appServer.setServerRequestHandler(async (request) => {
  const threadId = request.params.threadId;
  const subscribers = threadId ? this.threadSubscribers.get(threadId) : null;
  if (!subscribers || subscribers.size === 0) {
    return toSafeFallback(request);
  }
  return this.requestFromSubscribers(subscribers, request);
});
```

**requestFromSubscribers() — 새 메서드:**
```ts
// 모든 subscriber에게 같은 requestId로 server_request 전송
// 첫 응답이 resolve, 나머지는 무시
// pending request를 global map으로 관리 (session별이 아닌 requestId별)
```

**Pending request 구조 변경:**
```ts
// Before: session.pendingServerRequests (per-session)
// After: global pendingServerRequests map (per-requestId)
// 첫 응답 시 map에서 delete → 이후 응답은 lookup fail → 무시
```

**close() cleanup:**
```ts
// session 연결 끊길 때:
// 1. 해당 session의 모든 subscription 정리
// 2. threadSubscribers에서 sessionId 제거
// 3. 빈 Set이 되면 threadSubscribers에서 threadId 제거
// 4. pending server request 중 이 session만 남은 경우 → fallback resolve
```

**thread/subscribe, thread/unsubscribe 핸들러:**
- RpcBridge의 message() 메서드에서 appServer로 포워딩하지 않고 직접 처리 (bridge-level concern)

### 4. findSessionByThreadId → findSubscribersByThreadId

기존 `findSessionByThreadId()`는 단일 session 반환. 새로운 `findSubscribersByThreadId()`는 `Set<sessionId>` 반환.

### 5. Client-side (optional, 이번 scope에서는 최소)

- `packages/web/src/client/lib/rpc-client.ts`: `subscribe(threadId)`, `unsubscribe(subscriptionId)` 메서드 추가
- 기존 thread/start, thread/resume 사용 시 auto-subscribe되므로 기본 동작은 변경 없음

## Files to Modify

| File | Change |
|------|--------|
| `packages/protocol/src/methods.ts` | `THREAD_SUBSCRIBE`, `THREAD_UNSUBSCRIBE` 상수 추가 |
| `packages/protocol/src/index.ts` | subscribe/unsubscribe params & result 타입 추가 |
| `packages/web/src/server/rpc-bridge.ts` | 핵심 변경 — threadOwners→threadSubscribers, routeNotification fan-out, requestFromSubscribers first-responder, close cleanup |
| `packages/web/src/client/lib/rpc-client.ts` | subscribe/unsubscribe RPC 메서드 추가 |

## NOT in Scope

- TUI (in-process, single client — 변경 불필요)
- Role-based access control (향후 별도 plan)
- UI for managing subscriptions (향후)
- Desktop-specific changes (WebSocket 공유이므로 자동 적용)

## Verification

1. **기존 동작 유지**: Web에서 thread/start → turn/start → notification 수신 정상 동작
2. **Multi-tab 테스트**: 두 브라우저 탭으로 같은 서버 연결, 한쪽에서 thread/start 후 다른 쪽에서 thread/subscribe → 양쪽 모두 item/delta 수신 확인
3. **First-responder**: 두 탭 모두 approval 요청 수신, 한쪽만 응답 → 정상 처리, 다른쪽 응답 무시
4. **Disconnect cleanup**: 한 탭 닫기 → 다른 탭 정상 수신 계속
5. **기존 테스트**: `bun test` 통과
