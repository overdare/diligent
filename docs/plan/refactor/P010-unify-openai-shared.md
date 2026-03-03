---
id: P010
status: done
created: 2026-03-02
---

status: done
---

# Plan: Unify openai.ts + chatgpt.ts shared logic

## Context

`openai.ts`와 `chatgpt.ts`는 같은 OpenAI Responses API 포맷을 쓰지만 코드가 중복되어 있음.
- 메시지 변환 함수 완전히 동일 (함수 이름만 다름)
- stop reason 매핑 완전히 동일
- 이벤트 루프 (text, thinking, tool) 거의 동일

**진짜 차이점:**
- `openai.ts`: OpenAI SDK 사용 (`client.responses.create`) + API key 인증
- `chatgpt.ts`: raw fetch + OAuth 토큰 + 커스텀 헤더 (SDK 헤더를 ChatGPT 엔드포인트가 거부)

→ HTTP 연결 레이어는 합칠 수 없음. 이벤트 처리 + 유틸 레이어는 공유 가능.

## Approach

`openai-shared.ts`를 새로 만들어 공통 로직 추출. 두 entry point는 HTTP 연결만 담당.

## Files to create/modify

### 1. `packages/core/src/provider/openai-shared.ts` (new)
공통 유틸 모음:

```ts
// 메시지 변환 (convertToOpenAIInput / buildInput 통합)
export function convertMessages(messages: Message[]): OpenAIInputItem[]

// stop reason 매핑 (mapOpenAIStopReason / mapStopReason 통합)
export function mapStopReason(status: string | undefined): StopReason

// 도구 변환 (strict 여부 파라미터로)
export function buildTools(tools: ToolDefinition[], strict?: boolean): OpenAIToolDef[]

// 이벤트 루프 (핵심 — 공유 SSE 이벤트 핸들러)
// AsyncIterable<Record<string, unknown>> 을 받아서 stream에 push
export async function handleResponsesAPIEvents(
  iter: AsyncIterable<Record<string, unknown>>,
  stream: EventStream<ProviderEvent, ProviderResult>,
  model: Model,
  signal?: AbortSignal,
): Promise<void>
```

`handleResponsesAPIEvents`가 처리하는 이벤트:
- `response.output_text.delta` → `text_delta`
- `response.reasoning_summary_text.delta` → `thinking_delta`
- `response.output_item.done` (message / reasoning / function_call) → `text_end`, `thinking_end`, `tool_call_end`
- `response.output_item.added` → `tool_call_start`
- `response.function_call_arguments.delta` → `tool_call_delta`
- `response.completed` → `usage`, `done`
- `response.failed` → `error`

### 2. `packages/core/src/provider/openai.ts` (modify)
- SDK 이벤트를 `Record<string, unknown>`으로 캐스팅해서 `handleResponsesAPIEvents`에 전달
- `convertToOpenAIInput`, `mapOpenAIStopReason`, `convertToOpenAITools` 제거 → shared 사용
- 남는 코드: 클라이언트 생성 + `client.responses.create` 호출 (~40줄)

### 3. `packages/core/src/provider/chatgpt.ts` (modify)
- SSE 파싱은 그대로 유지 (fetch 필수)
- 파싱된 이벤트 객체를 `handleResponsesAPIEvents`에 전달
- `buildInput`, `mapStopReason`, `buildTools` 제거 → shared 사용
- 남는 코드: fetch 설정 + SSE reader + 이벤트 객체 수집 (~60줄)

## Key design decisions

- SDK → `Record<string, unknown>` 캐스팅: 어차피 chatgpt.ts에서도 이미 이 타입 쓰고 있음
- `handleResponsesAPIEvents`는 `AsyncIterable`을 받으므로 SDK stream도 일반 for-await로 iterate 가능
- chatgpt.ts의 text flush 안전망(`currentText` 잔여 flush)도 shared 함수 안에 포함
- `store: false`는 chatgpt body에만 남김 (openai에는 없는 필드)
- `strict: false`는 openai에만 전달 (chatgpt엔 없음)

## Verification

```bash
bun run --cwd packages/core tsc --noEmit
bun test packages/core
```
실행 후 web server 기동해서 OpenAI API key + ChatGPT OAuth 양쪽에서 thinking 모델로 테스트.
