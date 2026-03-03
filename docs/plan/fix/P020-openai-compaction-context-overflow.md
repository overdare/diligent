---
id: P020
status: done
created: 2026-03-03
---

# Fix OpenAI Compaction: Context Overflow Silent Failure

## Context

OpenAI 모델(gpt-5.3-codex 등) 사용 시 context가 커지면 에러 없이 무반응 발생.
마지막 세션 분석: inputTokens 168,792에서 user 메시지 추가 후 assistant 응답 0건, error 이벤트 0건.

**근본 원인 3가지:**

1. **Proactive compaction 부정확** — `estimateTokens`가 `chars/4` heuristic 사용. OpenAI 실제 토큰 수와 큰 차이 가능. API 응답의 `inputTokens`를 활용하지 않음.
2. **Reactive compaction 미트리거** — OpenAI `response.failed` SSE 이벤트가 `"unknown"` 타입으로 분류됨. `"context_overflow"`가 아니라서 compaction catch 안 됨.
3. **에러 무음 처리** — fatal error가 4초 toast로만 표시되어 사용자가 인지 불가.

## Scope

- OpenAI/ChatGPT provider에 대해서만 compaction 구현
- 다른 provider(Anthropic, Gemini)는 TODO 주석으로 남겨둠

## Changes

### 1. Actual token count 기반 proactive compaction

**File:** `packages/core/src/session/manager.ts`

- `lastApiInputTokens: number = 0` 필드 추가
- `handleEvent()` 에서 `message_end` 이벤트의 `event.message.usage.inputTokens` 캡처:
  ```typescript
  } else if (event.type === "message_end") {
    this.appendMessageEntry(event.message);
    if (event.message.usage.inputTokens > 0) {
      this.lastApiInputTokens = event.message.usage.inputTokens;
    }
  }
  ```
- `runWithCompaction()` proactive check에서 actual count 활용:
  ```typescript
  // Use max of heuristic estimate and last API-reported tokens
  const heuristicTokens = estimateTokens(currentMessages);
  const tokens = Math.max(heuristicTokens, this.lastApiInputTokens);
  ```
- 첫 turn은 heuristic 사용, 이후는 API 실제 값 사용 (자동 보정)

### 2. `response.failed` context overflow 분류 수정

**File:** `packages/core/src/provider/openai.ts`

- `isContextOverflow` 함수를 export로 변경 (현재 private)

**File:** `packages/core/src/provider/openai-shared.ts`

- `response.failed` 핸들러에서 context overflow 패턴 체크:
  ```typescript
  case "response.failed": {
    const resp = event.response as Record<string, unknown>;
    const respError = resp?.error as Record<string, unknown> | undefined;
    const msg = (respError?.message as string) ?? "Response failed";
    const errorType = isContextOverflow(msg) ? "context_overflow" : "unknown";
    stream.push({ type: "error", error: new ProviderError(msg, errorType, false) });
    return;
  }
  ```

### 3. 다른 provider에 TODO 주석 추가

**File:** `packages/core/src/provider/anthropic.ts`
- 파일 상단 또는 에러 분류 함수 근처에 TODO:
  ```typescript
  // TODO: Track actual inputTokens for proactive compaction (D-compact)
  ```

**File:** `packages/core/src/provider/gemini.ts`
- 동일한 TODO 주석 추가

### 4. Fatal error 가시성 개선

**File:** `packages/web/src/client/lib/thread-store.ts`

- error reducer에서 `fatal` 플래그를 toast에 전달:
  ```typescript
  case "error":
    return {
      ...state,
      toast: {
        id: `err-${Date.now()}`,
        kind: "error",
        message: notification.params.error.message,
        fatal: notification.params.fatal,
      },
    };
  ```

**File:** `packages/web/src/client/App.tsx`

- Fatal error toast는 auto-clear 하지 않음 (수동 dismiss만 가능):
  ```typescript
  useEffect(() => {
    if (!state.toast || state.toast.fatal) return;  // fatal은 auto-clear 안함
    const id = setTimeout(() => dispatch({ type: "clear_toast" }), 4000);
    return () => clearTimeout(id);
  }, [state.toast]);
  ```

## Verification

1. `bun test packages/core/` — 기존 compaction 테스트 통과 확인
2. `bun test packages/web/` — web 테스트 통과 확인
3. 수동 테스트: OpenAI 모델로 긴 세션 진행 → compaction 트리거 확인
4. `bunx tsc --noEmit` — 타입 체크

## File Summary

| File | Change |
|------|--------|
| `packages/core/src/session/manager.ts` | Track lastApiInputTokens, use in proactive compaction |
| `packages/core/src/provider/openai.ts` | Export isContextOverflow |
| `packages/core/src/provider/openai-shared.ts` | Classify response.failed context overflow |
| `packages/core/src/provider/anthropic.ts` | TODO comment |
| `packages/core/src/provider/gemini.ts` | TODO comment |
| `packages/web/src/client/lib/thread-store.ts` | Pass fatal flag to toast |
| `packages/web/src/client/App.tsx` | Fatal toast no auto-clear |
