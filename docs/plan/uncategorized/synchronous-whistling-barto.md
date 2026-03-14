# packages/core 본질적 리팩토링

## Context

`packages/core`의 전반적 아키텍처는 건강하다 — agent loop의 관심사 분리, `StreamFunction`/`EventStream` 기반 provider 추상화, Zod 기반 tool 인터페이스 모두 깔끔하다. 하지만 몇 가지 **구조적 결함**이 존재하며, 이것들은 파일 크기와 무관한 본질적인 문제다.

---

## Issue 1: llm ↔ agent 순환 의존 (High)

**문제**: `llm/compaction.ts`가 `agent/compaction.ts`의 `estimateTokens`를 import하고, `agent/compaction.ts`는 `llm/compaction.ts`의 `compact`를 import한다. llm은 agent보다 하위 레이어여야 하는데 상위를 참조한다.

**수정**: `estimateTokens`는 순수 유틸 함수(`chars / 4`)이므로 `llm/` 또는 `util/`로 이동.

**파일**:
- `packages/core/src/llm/compaction.ts` (line 4: `import { estimateTokens } from "../agent/compaction"`)
- `packages/core/src/agent/compaction.ts` (estimateTokens 정의 위치)

---

## Issue 2: core에 fs I/O가 있음 (Medium-High)

**문제**: `tool/truncation.ts`의 `persistFullOutput()`가 `node:fs/promises`, `node:os`로 직접 파일 시스템 작업을 한다. core는 순수 로직 레이어여야 하는데 I/O side effect가 존재한다.

**수정**: `persistFullOutput`를 strategy/callback으로 추출하여 runtime에서 주입하거나, `tool/executor.ts`에서 truncation 시 persist 로직을 ToolContext를 통해 주입받도록 변경.

**파일**:
- `packages/core/src/tool/truncation.ts` (lines 149-158)
- `packages/core/src/tool/executor.ts` (persistFullOutput 호출부)

---

## Issue 3: Global singleton 패턴 — 암묵적 런타임 결합 (Medium)

**문제**: `configureStreamResolver()`와 `configureCompactionRegistry()`가 모듈 레벨 전역 변수로 구현되어 있다. 컴파일 타임에 설정 여부를 보장할 수 없고, 설정 전 호출 시 런타임 에러만 발생한다. 테스트에서도 전역 상태를 reset해야 한다.

**수정**: DI 방식으로 전환 — Agent 생성자 또는 LoopRuntime에 StreamFunction을 직접 전달. 현재 `Agent` 클래스에서 `customModel.streamFn` 분기가 이미 있으므로, 항상 명시적 주입 경로를 사용하도록 통합.

**파일**:
- `packages/core/src/llm/stream-resolver.ts` (전역 resolver)
- `packages/core/src/agent/agent.ts` (resolveStream 사용부)
- `packages/core/src/llm/compaction.ts` (resolveStream 사용부)

---

## Issue 4: `CustomModel` — config에 runtime 의존성 (Medium)

**문제**: `CustomModel = Model & { streamFn: StreamFunction }` — 데이터 타입(Model)에 행위(StreamFunction)를 합치는 anti-pattern. 프로젝트의 `no_runtime_deps_in_config` 원칙 위반.

**수정**: `streamFn`을 `Model`에서 분리하여 별도 파라미터로 전달. Agent 생성자를 `model: string | Model, streamFn?: StreamFunction` 형태로 변경.

**파일**:
- `packages/core/src/agent/types.ts` (line 113: CustomModel 정의)
- `packages/core/src/agent/agent.ts` (CustomModel 사용부)

---

## Issue 5: `ProviderManagerConfig`의 callback (Low-Medium)

**문제**: `onOAuthTokensRefreshed?: (tokens) => Promise<void>` — config에 async callback이 포함됨. `no_runtime_deps_in_config` 위반.

**수정**: EventEmitter 패턴 또는 별도 메서드로 분리. `providerManager.onTokenRefresh(handler)` 형태.

**파일**:
- `packages/core/src/llm/provider-manager.ts` (line 17)

---

## Issue 6: `compact()` in-place mutation 비일관성 (Low)

**문제**: `Agent.prompt()`은 messages를 복사 후 staged-commit 하지만, `Agent.compact()`은 `this.messages`를 직접 splice로 변경한다. 실패 시 상태가 오염될 수 있다.

**수정**: `compact()`도 staged-commit 패턴 적용.

**파일**:
- `packages/core/src/agent/agent.ts` (`compact()` 메서드)
- `packages/core/src/agent/compaction.ts` (`runCompaction` — splice 대신 새 배열 반환)

---

## Execution Order

1. **Issue 1** (순환 의존 해소) — 가장 간단하고 영향도 높음
2. **Issue 6** (compact mutation) — 작은 변경, 안정성 향상
3. **Issue 4** (CustomModel 분리) — Issue 3의 선행 작업
4. **Issue 3** (global singleton → DI) — Issue 4 후 자연스럽게 통합
5. **Issue 2** (fs I/O 추출) — 독립적, 어느 시점이든 가능
6. **Issue 5** (callback 분리) — 가장 낮은 우선순위

---

## Verification

- `bun test` — packages/core/test/ 전체 테스트 통과 확인
- `bun run typecheck` — 타입 에러 없음 확인
- packages/runtime에서 core import 경로가 깨지지 않는지 확인
