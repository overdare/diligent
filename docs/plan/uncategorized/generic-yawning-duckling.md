# packages/core 본질적 리팩토링 분석

## Context

최근 P046 리팩토링으로 runtime 관심사(tools, sessions, config, approval 등)를 core에서 분리했다. 이 작업 이후 core는 5,020 lines으로 agent loop + LLM providers + tool interface + auth primitives를 담고 있다. 단순한 파일 길이가 아닌, core의 역할과 경계에 대한 본질적인 구조 문제를 분석한다.

---

## 분석 결과: 4가지 본질적 문제

### 1. Provider 구현체가 Core 안에 있다 (Dependency Inversion 위반)

**현상**: core의 `llm/provider/` 디렉토리에 4개 provider 구현체가 1,459 lines (core 전체의 29%)

| File | Lines | 역할 |
|------|-------|------|
| `openai-shared.ts` | 439 | OpenAI Responses API 공통 어댑터 |
| `anthropic.ts` | 415 | Anthropic SDK 바인딩 |
| `gemini.ts` | 249 | Google GenAI SDK 바인딩 |
| `chatgpt.ts` | 214 | ChatGPT raw fetch 클라이언트 |
| `openai.ts` | 150 | OpenAI SDK 바인딩 |

**왜 문제인가**:
- Core의 목적은 "재사용 가능한 agent engine" — **인터페이스를 정의**하는 곳이지 **구현체를 담는** 곳이 아니다
- `package.json`에 `@anthropic-ai/sdk`, `openai`, `@google/genai` 3개 SDK가 직접 의존 — 경량 엔진이 아닌 무거운 패키지가 됨
- Provider API가 바뀔 때마다 core가 변경됨 (core가 바뀌어야 할 이유가 아님)
- `provider-manager.ts:38`의 `PROVIDER_FACTORIES`가 하드코딩된 맵 — 새 provider 추가 시 core 수정 필수

**아이러니**: `stream-resolver.ts`라는 런타임 주입 메커니즘이 이미 존재한다. 그런데 실제 구현체는 여전히 core 안에 있어서, 인터페이스와 구현이 같은 패키지에 공존한다.

**반론**: examples/에서 core만으로 standalone 사용이 가능하다는 장점이 있다. 하지만 이는 `@diligent/providers` 같은 번들 패키지로 해결 가능하다.

---

### 2. Global Mutable State (Service Locator 패턴)

**현상**: 두 개의 전역 싱글톤이 존재

```
// stream-resolver.ts
let _resolver: StreamResolver | null = null;
configureStreamResolver(resolver)  →  resolveStream(provider)

// compaction.ts
let _defaultLookup: NativeCompactionLookup | undefined;
configureCompactionRegistry(lookup) →  compact() 내부에서 사용
```

**왜 문제인가**:
- `agent.ts:43` — `resolveStream(this.model.provider)`가 **전역 상태가 설정되었다고 가정**하고 호출
- `compaction.ts:157` — `_defaultLookup`이 없으면 fallback이 undefined
- 초기화 순서에 의존 — `configureStreamResolver()`가 Agent 생성 전에 호출되어야 함
- 컴파일 타임에 보장 없음 — 런타임에 "No stream resolver configured" 에러
- 테스트 격리를 위해 `resetStreamResolver()` / `resetCompactionRegistry()` 필요

**다만**: Agent와 compact 모두 명시적 `streamFn` 파라미터를 받을 수 있어 글로벌 상태 우회가 가능. 문제는 이것이 **선택적 파라미터**라서 빠뜨리면 자동으로 글로벌 상태에 의존하게 되는 것.

---

### 3. ProviderManager의 과도한 책임

**현상**: ProviderManager가 3가지 다른 관심사를 하나의 클래스에서 관리

| 책임 | 내부 구현 | 변경 이유 |
|------|----------|----------|
| Auth 상태 관리 | `AuthStateManager` (private class) | 새 인증 방식 추가 시 |
| Stream 팩토리/디스패치 | `StreamFactoryCache` (private class) | 새 provider 추가 시 |
| Compaction 레지스트리 | `createCompactionRegistry()` (function) | Compaction 전략 변경 시 |

거기에 더해 provider 메타데이터(`DEFAULT_MODELS`, `PROVIDER_HINTS`, `PROVIDER_NAMES`)도 이 파일에 있다.

**왜 문제인가**: 서로 다른 이유로 변경되는 것들이 같은 파일에 있다 (Single Responsibility 위반). Provider가 늘어날수록 이 파일에 대한 변경 빈도가 증가한다.

**다만**: 현재 283 lines으로 관리 가능한 크기. 내부적으로 이미 AuthStateManager / StreamFactoryCache로 분리되어 있어 구조는 준비되어 있다. Provider가 5-6개로 늘어나면 문제가 될 수 있다.

---

### 4. OpenAI / ChatGPT 분리가 부자연스럽다

**현상**:
- `openai.ts` (150 lines) + `chatgpt.ts` (214 lines) → 합계 364 lines
- 이 둘이 공유하는 `openai-shared.ts` → **439 lines** (공유 코드가 개별 구현보다 큼)

**구조적 의미**: "두 provider가 유틸리티를 공유"가 아니라 "하나의 API 형식(Responses API)에 두 가지 transport(SDK vs raw fetch)"이다. 공유 코드가 더 크다는 것은 추상화 경계가 잘못되었다는 신호.

**왜 문제인가**:
- Responses API 기능 추가 시 `openai-shared.ts`를 수정 → 두 provider 모두 영향
- 439 lines의 "shared" 파일은 사실상 숨겨진 모듈 — 독립적 테스트나 진화가 어렵다
- 개념적으로는 `OpenAIResponsesAdapter` + `SDKTransport` / `RawFetchTransport` 구조가 더 자연스럽다

---

## 문제가 아닌 것들 (잘 되어 있는 부분)

| 영역 | 상태 | 근거 |
|------|------|------|
| Agent loop (`loop.ts`: 147 lines) | 깔끔 | 단일 책임, 적절한 크기 |
| Tool system (325 lines 전체) | 깔끔 | 최소한의 인터페이스, 깔끔한 추상화 |
| EventStream (115 lines) | 깔끔 | 심플하고 효과적인 제네릭 |
| Type system (types.ts) | 깔끔 | Discriminated union, 적절한 제네릭 |
| Compaction 2-layer 분리 | 적절 | Agent가 "언제" 결정, LLM이 "어떻게" 실행 |
| Core-Runtime 경계 | 잘 됨 | 최근 리팩토링으로 깔끔히 분리됨 |
| 의존성 방향 | 올바름 | Core ← Runtime ← Protocol, 역방향 없음 |

---

## 우선순위 평가

| # | 문제 | 영향도 | 긴급도 | 비고 |
|---|------|--------|--------|------|
| 1 | Provider 구현체가 Core에 있음 | 높음 | 낮음 | Core의 정체성 문제이나, 현재 동작에는 문제 없음 |
| 2 | Global mutable state | 중간 | 낮음 | 테스트/디버깅 시 간헐적 문제 |
| 3 | ProviderManager 과도한 책임 | 중간 | 낮음 | Provider 수가 늘면 가속적으로 악화 |
| 4 | OpenAI/ChatGPT 추상화 경계 | 낮음 | 낮음 | openai-shared.ts가 커져도 기능엔 문제 없음 |

---

## 방향 (실행은 별도 판단)

### Provider 추출 (문제 1 해결 시)
- `packages/core/src/llm/provider/` → `packages/providers/` 또는 `packages/core-providers/`
- Core는 `StreamFunction` 인터페이스만 유지
- `ProviderManager`는 팩토리 주입을 받도록 변경 (하드코딩된 `PROVIDER_FACTORIES` 제거)
- Core의 `package.json`에서 3개 SDK 의존성 제거

### Service Locator 제거 (문제 2 해결 시)
- `streamFn`을 Agent constructor에서 **필수** 파라미터로 변경
- `resolveStream()` 글로벌 폴백 제거
- `configureCompactionRegistry()` 대신 명시적 파라미터 전달

### ProviderManager 분리 (문제 3 해결 시)
- `AuthStateManager`를 독립 export로 승격
- `StreamFactoryCache`를 별도 모듈로 분리
- `ProviderManager`는 이 둘을 조합하는 facade만 유지

### OpenAI 어댑터 정리 (문제 4 해결 시)
- `openai-shared.ts` → `responses-api-adapter.ts` (이름이 본질을 반영)
- `openai.ts`와 `chatgpt.ts`를 transport 레이어로 명시적 분리

---

## 핵심 파일 참조

- `packages/core/src/llm/provider-manager.ts` — 문제 1, 3의 중심
- `packages/core/src/llm/stream-resolver.ts` — 문제 2 (글로벌 상태)
- `packages/core/src/llm/compaction.ts:78-88` — 문제 2 (글로벌 상태)
- `packages/core/src/llm/provider/openai-shared.ts` — 문제 4
- `packages/core/src/agent/agent.ts:43` — 문제 2 (글로벌 상태 소비)
- `packages/core/src/index.ts` — 문제 1 (46+ LLM exports, 대부분 provider 구현 디테일)
