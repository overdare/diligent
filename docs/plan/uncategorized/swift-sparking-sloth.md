# Compaction 책임 분리: LLM 레이어 ← 실행, Agent 레이어 ← 조율

## Context

현재 `agent/compaction.ts`가 compaction의 **모든 것**을 담당:
- 조건 감지 (`shouldCompact`, `estimateTokens`)
- 메시지 선택 (`selectForCompaction`)
- LLM 호출로 요약 생성 (`generateSummary`)
- native vs fallback 분기 (`compactMessagesNativeFirst`)
- 결과 조립

문제: compaction의 "LLM 호출" 부분은 LLM 레이어 책임이고, agent는 native 지원 여부를 알 필요 없음. agent가 `streamFunction`을 compaction에 주입하는 것도 부자연스러움.

## Design

### 새 파일: `packages/core/src/llm/compaction.ts`

`agent/compaction.ts`에서 LLM 실행 로직을 이동:

- `generateSummary()` — LLM 호출로 요약 생성
- `compactMessages()` — select → summarize → 조립 파이프라인
- `compact()` — (기존 `compactMessagesNativeFirst`) native-first 통합 진입점
  - **핵심 변경**: `streamFunction`을 외부에서 받지 않고, 내부에서 `resolveStream(model.provider)`로 자체 해결
  - 테스트 등 커스텀 필요시 optional `streamFn?` 파라미터로 override 가능
- `CompactMessagesResult`, `CompactionPrompts`, `GenerateSummaryOptions` 타입
- `NATIVE_COMPACTION_PLACEHOLDER` 상수

```ts
// llm/compaction.ts 핵심 인터페이스
export interface LLMCompactInput {
  model: Model;
  messages: Message[];
  systemPrompt: SystemSection[];
  providerState?: ProviderState;
  sessionId?: string;
  config: LLMCompactConfig;
  signal?: AbortSignal;
  streamFn?: StreamFunction; // optional override (tests, custom models)
}

export interface LLMCompactConfig {
  reservePercent: number;
  keepRecentTokens: number;
  summaryPrefix?: string;
  prompts?: CompactionPrompts;
  nativePreferred?: boolean;
  nativeProviders?: string[];
  nativeRegistry?: NativeCompactionRegistry;
}

export async function compact(input: LLMCompactInput): Promise<CompactMessagesResult>
```

### 수정: `packages/core/src/agent/compaction.ts`

Agent-layer 조율 로직만 남김:

**유지:**
- `estimateTokens()` — 토큰 추정
- `shouldCompact()` — 조건 감지
- `selectForCompaction()` — 메시지 선택 (compact 후 재조립에 필요)
- `isSummaryMessage()`, `SUMMARY_PREFIX` — summary 식별

**제거 (→ `llm/compaction.ts`로 이동):**
- `generateSummary()`
- `compactMessages()`
- `compactMessagesNativeFirst()`
- `NativeFirstCompactionInput`, `NativeFirstCompactionConfig`
- `GenerateSummaryOptions`
- `CompactMessagesResult` (re-export from llm)
- `CompactionPrompts` (re-export from llm)

### 수정: `packages/core/src/agent/agent.ts`

`compact()` 메서드:
- `compactMessagesNativeFirst` → `llm/compaction.compact` 호출
- `streamFunction` 전달 제거 (LLM 레이어가 자체 해결)

### 수정: `packages/core/src/agent/loop.ts`

`compactIfNeeded()`:
- `compactMessagesNativeFirst` → `llm/compaction.compact` 호출
- `streamFunction` 전달 제거

### 수정: `packages/core/src/agent/types.ts`

`AgentConfig.compaction`:
- `nativeRegistry`, `nativePreferred`, `nativeProviders` 제거
- 이 값들은 LLM 레이어 config로 이동 (별도 설정 경로)

### 수정: `packages/core/src/agent/index.ts`

- `compactMessages`, `compactMessagesNativeFirst`, `generateSummary` export 제거
- `CompactionPrompts`, `CompactMessagesResult` re-export 경로 변경 (llm에서)

### 수정: `packages/core/src/llm/index.ts`

- `compact`, `CompactMessagesResult`, `CompactionPrompts`, `LLMCompactInput`, `LLMCompactConfig` export 추가

### 수정: `packages/core/src/agent/default.ts`

- `CompactionPrompts` import 경로 변경 (llm/compaction)
- `DEFAULT_COMPACTION_CONFIG` 타입 유지 (agent-level config만)

### NativeRegistry 설정 경로 변경

현재: `runtime → AgentConfig.compaction.nativeRegistry → agent → compaction`
변경: `runtime → LLM layer config` (별도 경로)

**방안**: `llm/compaction.ts`에 module-level registry 설정 함수:

```ts
let _defaultRegistry: NativeCompactionRegistry | undefined;
export function configureCompactionRegistry(registry: NativeCompactionRegistry): void {
  _defaultRegistry = registry;
}
```

Runtime startup에서 `configureCompactionRegistry(providerManager.createNativeCompactionRegistry())` 호출.
Agent는 native registry에 대해 전혀 모름.

### 수정이 필요한 Runtime 파일들

- `packages/runtime/src/session/manager.ts` — nativeRegistry 관련 코드 제거, startup 시 `configureCompactionRegistry` 호출
- `packages/runtime/src/config/runtime.ts` — compaction config에서 nativeRegistry 분리
- `packages/runtime/src/config/schema.ts` — 필요시 스키마 조정
- `packages/e2e/helpers/server-factory.ts` — nativeRegistry 설정 경로 변경

### 테스트 수정

- `packages/core/src/agent/__tests__/compaction.test.ts`
  - `generateSummary`, `compactMessages`, `compactMessagesNativeFirst` 테스트 → `packages/core/src/llm/__tests__/compaction.test.ts`로 이동
  - `estimateTokens`, `shouldCompact`, `selectForCompaction`, `isSummaryMessage` 테스트 유지

## File Change Summary

| File | Action |
|------|--------|
| `packages/core/src/llm/compaction.ts` | **신규** — LLM compaction 실행 로직 |
| `packages/core/src/llm/__tests__/compaction.test.ts` | **신규** — LLM compaction 테스트 |
| `packages/core/src/agent/compaction.ts` | **수정** — LLM 실행 코드 제거, 조율 로직만 |
| `packages/core/src/agent/agent.ts` | **수정** — compact() 호출 경로 변경 |
| `packages/core/src/agent/loop.ts` | **수정** — compactIfNeeded() 호출 경로 변경 |
| `packages/core/src/agent/types.ts` | **수정** — native 관련 필드 제거 |
| `packages/core/src/agent/index.ts` | **수정** — export 정리 |
| `packages/core/src/agent/default.ts` | **수정** — import 경로 |
| `packages/core/src/llm/index.ts` | **수정** — 새 export 추가 |
| `packages/core/src/agent/__tests__/compaction.test.ts` | **수정** — LLM 테스트 제거 |
| `packages/runtime/src/session/manager.ts` | **수정** — nativeRegistry 경로 변경 |
| `packages/runtime/src/config/runtime.ts` | **수정** — registry 설정 분리 |
| `packages/e2e/helpers/server-factory.ts` | **수정** — registry 설정 분리 |

## Verification

```bash
cd packages/core && bun test src/agent/__tests__/compaction.test.ts
cd packages/core && bun test src/llm/__tests__/compaction.test.ts
cd packages/runtime && bun test
cd packages/e2e && bun test
bun run typecheck  # 전체 타입 체크
```
