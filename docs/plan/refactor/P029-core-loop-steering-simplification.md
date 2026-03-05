---
id: P029
status: backlog
created: 2026-03-05
---

# Core Loop Steering Simplification

## Context

Diligent의 agent core loop에 steering(사용자 중간 입력) 처리가 두 개의 큐, 세 개의 drain point, 런타임 메시지 reorder 패치(normalizeToolMessages)로 분산되어 있다. Codex-rs는 동일한 문제를 **1개 큐, 1개 drain point(loop top), peek으로 flow control**하는 구조로 해결한다. 이 패턴을 따라 구조적으로 단순화한다.

**핵심 원칙:**
1. **Event-Ordered Persistence** — entry 저장은 consumer의 `handleEvent`를 통해서만 발생. EventStream이 push-based(no backpressure)이므로 agent loop 안에서 직접 persist하면 consumer가 아직 처리하지 못한 이벤트(turn_end 등)보다 먼저 entry가 쓰여서 순서가 깨진다. stream.push() 순서 = FIFO 소비 순서 = entry chain 순서.
2. Orphan/interleave repair는 session resume 시 1회 — 매번 context build마다가 아님
3. agentLoop은 순수 함수로 유지 — session, persistence, compaction을 모름

## Why Event-Ordered Persistence?

EventStream은 push-based, no backpressure다:

```
stream.push(event) → buffer에 쌓임 (consumer가 읽을 때까지)
                   → 또는 대기 중인 consumer에 즉시 전달
```

agent loop(producer)는 push 후 await 없이 바로 다음 코드를 실행한다. 만약 `drainPendingMessages()` 안에서 `appendMessageEntry()`를 호출하면:

```
Producer (agent loop)              Consumer (handleEvent)
─────────────────────              ──────────────────────
stream.push(turn_end)              [아직 못 읽음]
// await 없이 계속 실행
drainPendingMessages()
 → appendMessageEntry(steering)    [아직 못 읽음]
 → leafId 업데이트됨!
await streamLLM(...)  ← yield
                                   turn_end 수신 → appendMessageEntry(tool_result)
                                   → parentId = steering의 id ← 순서 깨짐!
```

entry chain: `assistant → steering → tool_result` — **틀린 순서.**

해법: persistence를 모두 consumer 쪽(handleEvent)으로 옮기면, stream FIFO 순서가 entry chain 순서를 보장한다:

```
Producer                            Consumer (FIFO)
─────────────────────               ──────────────────────
stream.push(turn_end)       [1]
stream.push(steering_injected) [2]
await streamLLM(...)  ← yield
                                    [1] turn_end → persist tool_results
                                    [2] steering_injected → persist steering
```

entry chain: `assistant → tool_result → steering` — **정상.**

## Changes

### Step 1: Merge steering queues

**File: `packages/core/src/session/manager.ts`**

- `steeringQueue` + `followUpQueue` → `pendingMessages: Message[]` 단일 큐
- `steer(content)`: `pendingMessages.push(msg)` (memory only, 현재와 동일)
- `followUp(content)`: `pendingMessages.push(msg)` (memory only, **변경**: 즉시 persist 제거)
- `drainPendingMessages()`: splice(0) 후 메시지만 반환 — **persist 하지 않음** (persistence는 handleEvent에서)
- `hasFollowUp()` → `hasPendingMessages(): boolean`: `pendingMessages.length > 0`
- `popPendingSteering()` → `popPendingMessages()`: 남은 pending 반환 + 큐 비우기
- `appendSteeringEntry()`: 삭제 (dead code)

**`resolveAgentConfig()` 변경:**
```typescript
return {
  ...base,
  getSteeringMessages: () => this.drainPendingMessages(),
  hasPendingMessages: () => this.pendingMessages.length > 0,
};
```

### Step 2: Unify drain to single point (loop top) + event-carried persistence

**File: `packages/core/src/agent/types.ts`**

- `AgentLoopConfig`에 `hasPendingMessages?: () => boolean` 추가
- `steering_injected` 이벤트에 messages 필드 추가:
  ```typescript
  | { type: "steering_injected"; messageCount: number; messages: Message[] }
  ```

**File: `packages/core/src/agent/loop.ts`**

현재 3개 drain → 1개 drain + 1개 peek:

```typescript
function drainSteering(
  config: AgentLoopConfig,
  allMessages: Message[],
  stream: EventStream<AgentEvent, Message[]>,
): boolean {
  if (!config.getSteeringMessages) return false;
  const msgs = config.getSteeringMessages();
  if (msgs.length === 0) return false;
  for (const msg of msgs) allMessages.push(msg);
  // messages를 이벤트에 포함 — consumer가 persist
  stream.push({ type: "steering_injected", messageCount: msgs.length, messages: msgs });
  return true;
}

// Loop body:
while (turnCount < maxTurns) {
  if (signal?.aborted) break;
  turnCount++;

  // 유일한 drain point
  drainSteering(config, allMessages, stream);

  const assistant = await streamLLM(...);
  allMessages.push(assistant);

  if (toolCalls.length === 0) {
    // peek only — drain은 다음 iteration top에서
    const hasPending = config.hasPendingMessages?.() ?? false;
    stream.push({ type: "turn_end", ... });
    if (hasPending) continue;
    break;
  }

  for (const tc of toolCalls) { /* execute, push result */ }

  // loop detector, turn_end
  // drain 없음 — next iteration top에서 처리
}
```

drain point가 loop top 하나이므로, `steering_injected`는 항상 이전 턴의 `turn_end` 뒤에 push된다. EventStream FIFO가 entry 순서를 보장:

```
turn N: turn_end(tool_results) → [queue position 1]
turn N+1 top: steering_injected(msgs) → [queue position 2]
Consumer: [1] persist tool_results → [2] persist steering ✅
```

- Line 188 `drainSteering` 유지 (유일한 drain point)
- Line 216 `drainSteering` → `hasPendingMessages()` peek으로 교체
- Line 300 `drainSteering` 삭제

### Step 3: Flatten SessionManager control flow + event-ordered handleEvent

**File: `packages/core/src/session/manager.ts`**

`handleEvent`에 `steering_injected` 처리 추가:

```typescript
private handleEvent(event: AgentEvent): void {
  if (event.type === "message_end") {
    this.appendMessageEntry(event.message);
    if (event.message.usage.inputTokens > 0) {
      this.lastApiInputTokens = event.message.usage.inputTokens;
    }
  } else if (event.type === "turn_end") {
    for (const toolResult of event.toolResults) {
      this.appendMessageEntry(toolResult);
    }
  } else if (event.type === "steering_injected") {
    // Event-Ordered Persistence: consumer에서 persist
    for (const msg of event.messages) {
      this.appendMessageEntry(msg);
    }
  }
}
```

persistence 순서가 EventStream FIFO에 의해 보장됨:
- `turn_end` → tool_results persist
- `steering_injected` → steering persist (항상 turn_end 뒤)

`executeLoop()` + `proxyAgentLoop()` + `runAgentLoopInner()` → `runSession()` 단일 메서드:

```typescript
private async runSession(
  messages: Message[],
  compactionConfig: CompactionConfig,
  outerStream: EventStream<AgentEvent, Message[]>,
): Promise<void> {
  let currentMessages = messages;

  // Proactive compaction
  if (compactionConfig.enabled && shouldCompact(...)) {
    currentMessages = await this.performCompaction(..., outerStream);
  }

  outerStream.push({ type: "agent_start" });

  while (true) {
    let result: Message[];

    try {
      const innerStream = agentLoop(currentMessages, this.resolveAgentConfig());
      for await (const event of innerStream) {
        if (event.type === "agent_start" || event.type === "agent_end") continue;
        this.handleEvent(event);
        // Intercept fatal context_overflow
        if (event.type === "error" && event.fatal) {
          /* check context_overflow → throw ProviderError */
          continue;
        }
        outerStream.push(event);
      }
      result = await innerStream.result();
    } catch (err) {
      if (isContextOverflow(err) && compactionConfig.enabled) {
        currentMessages = await this.performCompaction(..., outerStream);
        continue;
      }
      throw err;
    }

    // Check unified queue — pending messages trigger next iteration
    if (this.pendingMessages.length === 0) {
      outerStream.push({ type: "agent_end", messages: result });
      outerStream.end(result);
      return;
    }

    // Rebuild context for next iteration
    const context = buildSessionContext(this.entries, this.leafId);
    currentMessages = context.messages;
  }
}
```

- `run()` 에서 `this.executeLoop(...)` → `this.runSession(...)` 호출
- `executeLoop`, `proxyAgentLoop`, `runAgentLoopInner` 삭제

### Step 4: Remove normalizeToolMessages, add resume-time repair

**File: `packages/core/src/session/context-builder.ts`**

- `normalizeToolMessages()` 함수 삭제
- `buildSessionContext()` 반환에서 normalizeToolMessages 호출 제거:
  ```typescript
  // Before
  messages: options?.skipRepair ? messages : deduplicateUserMessages(normalizeToolMessages(messages)),
  // After
  messages: deduplicateUserMessages(messages),
  ```
- `skipRepair` 옵션 제거 (더 이상 repair 개념 없음)

**File: `packages/core/src/session/manager.ts`** — resume()에 entry repair 추가:

```typescript
async resume(options: ResumeSessionOptions): Promise<boolean> {
  // ... 기존 로직 ...
  if (!sessionPath) return false;

  const { entries } = await readSessionFile(sessionPath);
  this.entries = entries;
  // ... byId, leafId 설정 ...

  this.repairEntries();

  return true;
}

private repairEntries(): void {
  // 1. Orphaned tool_calls repair
  // entries path의 마지막 message entry 확인
  // assistant(tool_calls)인데 matching tool_result가 없으면
  // synthetic "interrupted" tool_result entry 추가

  // 2. Interleaved steering repair (기존 세션 하위호환)
  // 구 버전에서 저장된 세션: followUp이 tool_use↔tool_result 사이에 persist된 경우
  // assistant(tool_calls) → steering → tool_result 순서를
  // assistant(tool_calls) → tool_result → steering 으로 entry parentId 재연결
}
```

interleave repair는 구 버전 세션 파일 마이그레이션 용도. 새 코드에서는 Event-Ordered Persistence가 구조적으로 방지하므로 발생하지 않음.

### Step 5: Update app-server

**File: `packages/core/src/app-server/server.ts`**

- `handleTurnSteer()`: followUp 분기 제거, 항상 `manager.steer(content)` 호출
  - Protocol에서 followUp 파라미터는 유지하되 내부적으로 동일 처리
- `consumeStream()`: `popPendingSteering()` → `popPendingMessages()` 호출명 변경

### Step 6: Update types

**File: `packages/core/src/session/types.ts`**

- `SteeringEntry.source` 타입: `"steer" | "follow_up"` → 더 이상 entry에 persist하지 않으므로 source 필드 불필요할 수 있음. 단, 기존 session 파일 호환을 위해 타입은 유지하되 새로 생성하지 않음.

### Step 7: Update tests

**File: `packages/core/test/agent-loop-steering.test.ts`**
- "after tool execution" drain 테스트 → "before next LLM call" drain으로 변경
- hasPendingMessages peek 테스트 추가
- `steering_injected` 이벤트에 messages 포함 검증
- 기존 7개 테스트 시나리오는 동일 행동 보장 (LLM이 보는 순서 불변)

**File: `packages/core/test/session-steering.test.ts`**
- followUp persist 테스트 수정 (즉시 persist → drain 시 persist)
- 2큐 테스트 → 1큐 테스트
- hasFollowUp → hasPendingMessages
- Event-Ordered Persistence 테스트: steering이 tool_result 뒤에 persist되는지 검증

**File: `packages/core/test/session-context-builder.test.ts`**
- normalizeToolMessages 관련 테스트 4개 삭제
- orphan/interleave repair 테스트는 session-manager 테스트로 이동

## Files to Modify

| File | Change |
|------|--------|
| `packages/core/src/session/manager.ts` | Queue merge, handleEvent steering persist, flatten control flow, add entry repair |
| `packages/core/src/agent/loop.ts` | 3 drain → 1 drain + 1 peek, steering_injected에 messages 포함 |
| `packages/core/src/agent/types.ts` | Add `hasPendingMessages` to config, steering_injected에 messages 추가 |
| `packages/core/src/session/context-builder.ts` | Remove normalizeToolMessages |
| `packages/core/src/app-server/server.ts` | Update steer/followUp handling |
| `packages/core/src/session/types.ts` | SteeringEntry source optional |
| `packages/core/test/agent-loop-steering.test.ts` | Update drain point tests |
| `packages/core/test/session-steering.test.ts` | Update queue merge tests |
| `packages/core/test/session-context-builder.test.ts` | Remove normalize tests |

## Execution Order

1. Step 1 (queue merge) + Step 2 (drain unify + event-carried persistence) — 기반 변경
2. Step 3 (handleEvent steering persist + flatten control flow) — SessionManager 내부 리팩터
3. Step 4 (normalizeToolMessages 제거 + entry repair) — context-builder 정리
4. Step 5 (app-server) + Step 6 (types)
5. Step 7 (tests) — 각 step 완료 후 즉시 테스트 수정

## Verification

```bash
# 전체 테스트
cd packages/core && bun test

# Steering 관련 테스트
bun test test/agent-loop-steering.test.ts
bun test test/session-steering.test.ts
bun test test/session-context-builder.test.ts

# Session manager 테스트
bun test test/session-manager.test.ts
```

구조적 보장 검증:
- tool 실행 중 steer() 호출 시 entry tree에 steering이 tool_use↔tool_result 사이에 절대 위치하지 않음 (Event-Ordered Persistence가 FIFO 순서로 보장)
- session resume 시 orphaned tool_calls에 synthetic result 삽입됨
- session resume 시 구 버전 interleaved entries가 재연결됨
- 모든 steering이 LLM 호출 직전에만 drain됨
- agent loop 안에서 appendMessageEntry 호출 없음 (순수 함수 유지)
