---
id: P051
status: backlog
created: 2026-03-14
---

# Compaction Logic을 Core Agent로 이동

## Goal

Agent가 자체적으로 compaction을 판단/실행하도록 만들어, runtime의 `onTurnEnd` 훅과 SessionManager의 compaction 오케스트레이션 복잡도를 제거한다.

## Prerequisites

None.

## Artifact

```
[turn 끝] → Agent 내부에서 estimateTokens → shouldCompact 판단
         → 초과 시 generateSummary 호출 → messages 교체
         → compaction_start/compaction_end 이벤트 emit
         → SessionManager는 이벤트 수신해서 CompactionEntry persist만 담당
```

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| `packages/core/src/agent/` | 새 `compaction.ts` 추가, `Agent._runLoop`에 compaction 통합, `onTurnEnd` 시그니처 단순화 |
| `packages/core/src/agent/types.ts` | `AgentConfig`에 `compaction` 옵션 추가, `CoreAgentEvent`에 compaction 이벤트 추가 |
| `packages/runtime/src/session/compaction.ts` | 삭제 (로직 core로 이동) |
| `packages/runtime/src/session/types.ts` | `CompactionDetails` 제거, `CompactionEntry.details` 제거 |
| `packages/runtime/src/session/context-builder.ts` | `formatFileOperations` 참조 제거 |
| `packages/runtime/src/session/manager.ts` | `onTurnEnd` compaction 로직 제거, 이벤트 기반 persist로 전환 |
| `packages/runtime/src/agent-event.ts` | `compaction_start/end`를 `RuntimeAgentEvent`에서 제거 (core로 이동) |
| `packages/debug-viewer/` | `CompactionEntry.details` 렌더링 제거 |
| 테스트 파일들 | compaction 테스트를 core로 이동, runtime 테스트 업데이트 |

### What does NOT change

- Session persistence 구조 (JSONL 형식, tree 기반 entry chain)
- `compactNow()` 기능 자체 (명시적 compact 명령은 유지)
- Web/TUI compaction UI (이벤트 타입은 동일, 출처만 core로 변경)
- `buildSessionContext` / `buildSessionTranscript` 함수 구조 (file ops 부분만 제거)

## File Manifest

### packages/core/src/agent/

| File | Action | Description |
|------|--------|------------|
| `compaction.ts` | CREATE | `estimateTokens`, `shouldCompact`, `SUMMARY_PREFIX`, `isSummaryMessage`, `generateSummary`, `selectForCompaction`, `compactMessages` |
| `agent.ts` | MODIFY | 루프에 compaction 통합, `onTurnEnd` 단순화 (→ `() => Promise<void>`) |
| `types.ts` | MODIFY | `AgentConfig.compaction`, `CoreAgentEvent`에 `compaction_start`/`compaction_end` 추가 |
| `index.ts` | MODIFY | 새 exports 추가 |

### packages/runtime/src/session/

| File | Action | Description |
|------|--------|------------|
| `compaction.ts` | DELETE | 전체 삭제 |
| `types.ts` | MODIFY | `CompactionDetails` 제거, `CompactionEntry.details` 제거 |
| `context-builder.ts` | MODIFY | `formatFileOperations` import/사용 제거, summary만 사용 |
| `manager.ts` | MODIFY | compaction 오케스트레이션 제거, 이벤트 기반 persist |
| `index.ts` | MODIFY | 삭제된 exports 제거 |

### packages/runtime/src/

| File | Action | Description |
|------|--------|------------|
| `agent-event.ts` | MODIFY | `compaction_start/end`를 `RuntimeAgentEvent`에서 제거 |
| `index.ts` | MODIFY | 삭제된 exports 제거 |

### packages/debug-viewer/

| File | Action | Description |
|------|--------|------------|
| `src/shared/types.ts` | MODIFY | `CompactionEntry.details` 필드 제거 |
| `src/client/components/MessageCard.tsx` | MODIFY | file ops 렌더링 제거 |

### 테스트 파일

| File | Action | Description |
|------|--------|------------|
| `packages/core/src/agent/__tests__/compaction.test.ts` | CREATE | core로 이동된 함수들의 테스트 |
| `packages/runtime/src/session/__tests__/compaction.test.ts` | DELETE | 삭제 |
| `packages/runtime/src/session/__tests__/context-builder.test.ts` | MODIFY | file ops assertion 제거 |
| `packages/runtime/src/session/__tests__/manager.test.ts` | MODIFY | compaction 테스트 업데이트 |

## Implementation Tasks

### Task 1: Core에 compaction.ts 생성

**Files:** `packages/core/src/agent/compaction.ts`, `packages/core/src/agent/index.ts`

runtime의 `compaction.ts`에서 순수 함수들을 이동하고, `Message[]` 기반으로 `selectForCompaction` 작성.

```typescript
// packages/core/src/agent/compaction.ts

export function estimateTokens(messages: Message[]): number { /* 기존 그대로 */ }
export function shouldCompact(estimatedTokens: number, contextWindow: number, reservePercent: number): boolean { /* 기존 그대로 */ }
export const SUMMARY_PREFIX = "Another language model started to solve this problem...";
export function isSummaryMessage(msg: Message): boolean { /* 기존 그대로 */ }

/**
 * Message[] 기반 compaction 대상 선택.
 * SessionEntry가 아닌 Message[]에서 작동 — SUMMARY_PREFIX로 이전 compaction 경계 식별.
 */
export function selectForCompaction(
  messages: Message[],
  keepRecentTokens: number,
): { messagesToSummarize: Message[]; recentUserMessages: Message[]; previousSummary?: string } {
  // 1. 마지막 summary message 찾기 (SUMMARY_PREFIX로 시작하는 user message)
  // 2. 그 이후 모든 messages가 요약 대상
  // 3. 최근 user messages를 keepRecentTokens 예산 내에서 선택
  // 4. previousSummary 추출 (있으면)
}

export async function generateSummary(
  messages: Message[],
  streamFunction: StreamFunction,
  model: Model,
  options: { previousSummary?: string; signal?: AbortSignal; reservePercent?: number },
): Promise<string> { /* 기존 그대로 */ }

/**
 * 전체 compaction 실행: 선택 → 요약 → 새 메시지 배열 구성
 */
export async function compactMessages(
  messages: Message[],
  streamFunction: StreamFunction,
  model: Model,
  config: { reservePercent: number; keepRecentTokens: number },
  signal?: AbortSignal,
): Promise<{ messages: Message[]; summary: string; recentUserMessages: Message[]; tokensBefore: number; tokensAfter: number }> {
  const tokensBefore = estimateTokens(messages);
  const { messagesToSummarize, recentUserMessages, previousSummary } = selectForCompaction(messages, config.keepRecentTokens);
  const summary = await generateSummary(messagesToSummarize, streamFunction, model, {
    previousSummary, signal, reservePercent: config.reservePercent,
  });
  const compacted: Message[] = [
    ...recentUserMessages,
    { role: "user", content: `${SUMMARY_PREFIX}\n\n${summary}`, timestamp: Date.now() },
  ];
  return { messages: compacted, summary, recentUserMessages, tokensBefore, tokensAfter: estimateTokens(compacted) };
}
```

**Verify:** `bun test packages/core` — 새 compaction 테스트 통과

### Task 2: CoreAgentEvent + AgentConfig 타입 확장

**Files:** `packages/core/src/agent/types.ts`

```typescript
// AgentConfig에 추가
export interface AgentConfig {
  // ... 기존 필드
  compaction?: {
    reservePercent: number;
    keepRecentTokens: number;
  };
}

// CoreAgentEvent에 추가
| { type: "compaction_start"; estimatedTokens: number }
| { type: "compaction_end"; tokensBefore: number; tokensAfter: number; summary: string; recentUserMessages: Message[] }
```

**Verify:** 타입 체크 통과 (`bunx tsc --noEmit`)

### Task 3: Agent._runLoop에 compaction 통합

**Files:** `packages/core/src/agent/agent.ts`

```typescript
// OnTurnEndContext 제거, onTurnEnd 단순화
export class Agent {
  /** Optional hook called between turns. Use to refresh config. */
  onTurnEnd?: () => Promise<void> | void;

  private async _runLoop(...) {
    while (...) {
      // ... LLM call, tool execution ...

      this.emit({ type: "turn_end", turnId, message: assistantMessage, toolResults });

      // 1. onTurnEnd hook (config refresh용)
      if (this.onTurnEnd) await this.onTurnEnd();

      // 2. Proactive compaction
      if (this._config.compaction) {
        const tokens = estimateTokens(allMessages);
        if (shouldCompact(tokens, this._config.model.contextWindow, this._config.compaction.reservePercent)) {
          this.emit({ type: "compaction_start", estimatedTokens: tokens });
          const result = await compactMessages(
            allMessages, this._config.streamFunction, this._config.model,
            this._config.compaction, config.signal,
          );
          allMessages.splice(0, allMessages.length, ...result.messages);
          this.emit({
            type: "compaction_end",
            tokensBefore: result.tokensBefore, tokensAfter: result.tokensAfter,
            summary: result.summary, recentUserMessages: result.recentUserMessages,
          });
        }
      }

      if (abortAfterTurn) break;
    }
  }
}
```

Reactive compaction (context_overflow 에러 시):

```typescript
// _runLoop 안에서 streamAssistantResponse를 try-catch
try {
  assistantMessage = await streamAssistantResponse(...);
} catch (err) {
  if (isContextOverflow(err) && this._config.compaction && !reactiveCompacted) {
    reactiveCompacted = true;
    this.emit({ type: "compaction_start", estimatedTokens: estimateTokens(allMessages) });
    const result = await compactMessages(...);
    allMessages.splice(0, allMessages.length, ...result.messages);
    this.emit({ type: "compaction_end", ... });
    continue; // retry turn
  }
  throw err;
}
```

**Verify:** 기존 agent 테스트 + 새 compaction 통합 테스트 통과

### Task 4: runtime의 compaction 관련 코드 제거/업데이트

**Files:** 여러 파일 (아래 상세)

**4a. `session/compaction.ts` 삭제**

**4b. `session/types.ts`** — `CompactionDetails` 제거, `CompactionEntry.details` 제거:
```typescript
export interface CompactionEntry {
  type: "compaction";
  id: string;
  parentId: string | null;
  timestamp: string;
  summary: string;
  recentUserMessages: Message[];
  tokensBefore: number;
  tokensAfter: number;
  // details 필드 제거됨
}
```

**4c. `session/context-builder.ts`** — `formatFileOperations` 참조 제거:
```typescript
// Before: const summaryWithFiles = lastCompaction.summary + formatFileOperations(lastCompaction.details);
// After:
import { SUMMARY_PREFIX } from "@diligent/core/agent/compaction";
// ...
messages.push({
  role: "user",
  content: `${SUMMARY_PREFIX}\n\n${lastCompaction.summary}`,
  timestamp: Date.parse(lastCompaction.timestamp),
});
```

**4d. `agent-event.ts`** — `compaction_start`/`compaction_end`를 `RuntimeAgentEvent`에서 제거 (core로 이동됨)

**4e. `session/index.ts`, `runtime/index.ts`** — 삭제된 export 정리

**Verify:** `bunx tsc --noEmit` 통과

### Task 5: SessionManager 리팩터

**Files:** `packages/runtime/src/session/manager.ts`

핵심 변경:
1. `onTurnEnd` compaction 로직 제거 → config refresh만 남김
2. `compaction_end` 이벤트 구독으로 `CompactionEntry` persist
3. Reactive compaction 로직 제거 (Agent 내부로 이동)
4. `compactNow()` — core의 `compactMessages` 직접 호출

```typescript
async run(userMessage: Message, opts?: ...): Promise<void> {
  // ... 기존 setup ...

  // onTurnEnd → config refresh만
  agent.onTurnEnd = async () => {
    const nextAgent = await this.resolveAgent();
    if (nextAgent !== agent) {
      agent.setModel(nextAgent.config.model);
      agent.setTools(nextAgent.config.tools);
      agent.setSystemPrompt(nextAgent.config.systemPrompt);
      agent.setEffort(nextAgent.config.effort);
      agent.setFilterTool(nextAgent.config.filterTool);
    }
  };

  const unsub = agent.subscribe((event: CoreAgentEvent) => {
    // 기존 persist 로직
    this.persistAgentEvent(event);
    this.emitToListeners(event);

    // compaction_end → CompactionEntry persist
    if (event.type === "compaction_end") {
      this.persistCompactionEntry(event);
    }
  });

  // reactive compaction retry 루프 제거 — 단순 prompt 호출
  try {
    await agent.prompt(context.messages, promptOpts);
  } catch (err) {
    // ... abort/error handling (no context_overflow retry) ...
  }
}

private persistCompactionEntry(event: { summary: string; recentUserMessages: Message[]; tokensBefore: number; tokensAfter: number }) {
  const entry: CompactionEntry = {
    type: "compaction",
    id: generateEntryId(),
    parentId: this.leafId,
    timestamp: new Date().toISOString(),
    summary: event.summary,
    recentUserMessages: event.recentUserMessages,
    tokensBefore: event.tokensBefore,
    tokensAfter: event.tokensAfter,
  };
  this.entries.push(entry);
  this.byId.set(entry.id, entry);
  this.leafId = entry.id;
  this.writeQueue = this.writeQueue.then(() => this.writer.write(entry)).catch(() => {});
}
```

**Verify:** `bun test packages/runtime` — manager 테스트 통과

### Task 6: Debug Viewer 업데이트

**Files:** `packages/debug-viewer/src/shared/types.ts`, `packages/debug-viewer/src/client/components/MessageCard.tsx`

- `CompactionEntry.details` 필드를 optional로 변경 (backward compat for old sessions)
- `CompactionCard`에서 file ops 렌더링 제거

**Verify:** debug-viewer 빌드 성공

### Task 7: 테스트 마이그레이션

**Files:** 여러 테스트 파일

- `runtime/session/__tests__/compaction.test.ts` → `core/agent/__tests__/compaction.test.ts`로 이동
  - `extractFileOperations`, `formatFileOperations` 테스트 삭제
  - `findRecentUserMessages` → `selectForCompaction`으로 대체 (Message[] 기반)
- `runtime/session/__tests__/context-builder.test.ts` — file ops assertion 제거
- `runtime/session/__tests__/manager.test.ts` — compaction 테스트를 이벤트 기반으로 업데이트

**Verify:** `bun test` 전체 통과

## Acceptance Criteria

1. `bun test` — 전체 테스트 통과
2. `bunx tsc --noEmit` — 타입 에러 없음
3. Agent가 자체적으로 proactive + reactive compaction 실행
4. SessionManager에 compaction 판단/실행 로직 없음
5. `onTurnEnd`에서 `messages` 반환 패턴 제거됨
6. `/compact` 명령 정상 동작
7. `extractFileOperations`, `formatFileOperations`, `CompactionDetails` 코드베이스에서 완전 제거

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | `estimateTokens`, `shouldCompact`, `selectForCompaction`, `compactMessages` | `bun test packages/core` |
| Unit | `generateSummary` with mock stream | `bun test packages/core` |
| Integration | Agent loop에서 proactive compaction 트리거 | core agent test with small contextWindow |
| Integration | Agent loop에서 reactive compaction (context_overflow) | core agent test with error injection |
| Integration | SessionManager가 compaction_end 이벤트로 CompactionEntry persist | `bun test packages/runtime` |
| Integration | `/compact` 명시적 compaction | manager test |
| Manual | 긴 대화에서 자동 compaction 발생 확인 | TUI or Web |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `selectForCompaction`이 `findRecentUserMessages`와 동작 차이 | 요약 품질 저하 | 동일 로직, 입력 타입만 `Message[]`로 변경. SUMMARY_PREFIX 기반 경계 탐지. |
| 기존 세션 파일에 `CompactionEntry.details` 있음 | 파싱 에러 | 필드를 optional로 두되 사용하지 않음 |
| `onTurnEnd` 단순화로 config refresh 타이밍 변경 | 중간 턴에서 config 미적용 | `onTurnEnd`는 동기적으로 await되므로 동일 |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D037 | Compaction — LLM-based with iterative summary updating | Task 1 (generateSummary) |
| D038 | Compaction trigger — token-based automatic | Task 1 (shouldCompact), Task 3 (Agent loop) |
| D039 | File operation tracking across compactions | **삭제 대상** — 이 plan에서 제거 |
