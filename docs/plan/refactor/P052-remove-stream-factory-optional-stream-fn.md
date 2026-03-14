---
id: P052
status: backlog
created: 2026-03-14
---

# Remove streamFactory from AgentInit — Optional StreamFn + Global Registry

## Context

현재 `AgentInit`에 `streamFactory: () => StreamFunction`이 필수 주입되어 있다. 하지만 실제 사용 패턴을 보면:
- Runtime: `streamFactory: () => runtimeConfig.streamFunction` (매번 같은 함수 반환)
- Core: `streamFactory: () => createStreamFromEnv(model.provider)` (env에서 키 읽기)
- Tests: `streamFactory: () => mockStreamFn` (모든 테스트에서 boilerplate)

factory-of-a-factory 간접 참조가 실질적 가치를 제공하지 않는다. pi-mono 레퍼런스도 **optional `streamFn` + global registry** 하이브리드 패턴을 사용한다.

**목표**: `streamFactory`를 `AgentInit`에서 제거하고, Agent가 LLM 레이어를 직접 참조하되, optional `streamFn` 오버라이드로 테스트/프록시 유연성을 유지.

## Design

### 핵심 아이디어

```typescript
// AgentInit — streamFactory 제거, optional streamFn 추가
interface AgentInit extends AgentConfig {
  model: Model;
  systemPrompt: SystemSection[];
  tools: Tool[];
  effort: ThinkingEffort;
  streamFn?: StreamFunction;  // optional override
}

// Agent.prompt() — streamFn 있으면 사용, 없으면 글로벌 레지스트리에서 resolve
prompt(messages, opts, signal) {
  const streamFunction = this.streamFn ?? resolveStream(this.model.provider);
  return runAgentLoop(messages, { streamFunction, ... });
}
```

### Step 1: 글로벌 stream resolver 생성

**New file**: `packages/core/src/llm/stream-resolver.ts`

```typescript
type StreamResolver = (provider: string) => StreamFunction;

let _resolver: StreamResolver | null = null;

/** Configure the global stream resolver (called once at app startup) */
export function configureStreamResolver(resolver: StreamResolver): void {
  _resolver = resolver;
}

/** Resolve a StreamFunction for the given provider */
export function resolveStream(provider: string): StreamFunction {
  if (_resolver) return _resolver(provider);
  return createStreamFromEnv(provider); // default fallback
}

/** Reset resolver to default (for test cleanup) */
export function resetStreamResolver(): void {
  _resolver = null;
}
```

- **Default**: `createStreamFromEnv()` fallback (env var 기반, `createAgent()` simple path 동작 유지)
- **Runtime**: startup 시 `configureStreamResolver()` 호출
- **Tests**: mock resolver 설정 후 `afterEach`에서 `resetStreamResolver()`

### Step 2: `AgentInit` 타입 변경

**File**: `packages/core/src/agent/types.ts`

```diff
 interface AgentInit extends AgentConfig {
   model: Model;
   systemPrompt: SystemSection[];
   tools: Tool[];
-  streamFactory: () => StreamFunction;
+  streamFn?: StreamFunction;  // optional — falls back to global registry
   effort: ThinkingEffort;
 }
```

### Step 3: `Agent` 클래스 수정

**File**: `packages/core/src/agent/agent.ts`

- `this.streamFactory` → `this.streamFn` (optional)
- `prompt()`: `this.streamFn ?? resolveStream(this.model.provider)`
- `compact()`: 동일

```diff
 export class Agent {
-  streamFactory: AgentInit["streamFactory"];
+  streamFn: AgentInit["streamFn"];

   constructor(init: AgentInit) {
-    this.streamFactory = init.streamFactory;
+    this.streamFn = init.streamFn;
   }

   prompt(messages, opts, signal) {
-    const streamFunction = this.streamFactory();
+    const streamFunction = this.streamFn ?? resolveStream(this.model.provider);
     return runAgentLoop(messages, { streamFunction, ... });
   }

   compact(messages, signal) {
-    const streamFunction = this.streamFactory();
+    const streamFunction = this.streamFn ?? resolveStream(this.model.provider);
   }
 }
```

### Step 4: `createAgent()` 간소화

**File**: `packages/core/src/agent/create-agent.ts`

```diff
-export type CreateAgentConfig = Omit<AgentInit, "model" | "streamFactory">;
+export type CreateAgentConfig = Omit<AgentInit, "model">;

 export function createAgent(modelId: string, config: CreateAgentConfig): Agent {
   const model = resolveModel(modelId);
-  return new Agent({ ...config, model, streamFactory: () => createStreamFromEnv(model.provider) });
+  return new Agent({ ...config, model });
+  // streamFn 미제공 → resolveStream() fallback → createStreamFromEnv()
 }
```

### Step 5: Runtime 경로 — configureStreamResolver 호출

**File**: `packages/runtime/src/config/runtime.ts`

```diff
+import { configureStreamResolver } from "@diligent/core/llm/stream-resolver";

 export async function loadRuntimeConfig(cwd, paths) {
   // ... providerManager setup ...
   const streamFunction = providerManager.createProxyStream();
+  configureStreamResolver(() => streamFunction);
   // ...
 }
```

### Step 6: Factory/Registry에서 streamFactory 제거

**File**: `packages/runtime/src/app-server/factory.ts` (line 112)
```diff
-          streamFactory: () => runtimeConfig.streamFunction,
           // streamFn 미제공 → global resolver 사용
```

**File**: `packages/runtime/src/collab/registry.ts` (line 165)
```diff
-            streamFactory: () => this.deps.streamFunction,
             // streamFn 미제공 → global resolver 사용
```

### Step 7: Mock provider 생성

**New file**: `packages/core/src/llm/provider/mock.ts`

테스트에서 반복되는 EventStream boilerplate를 제거하는 재사용 가능한 mock.

```typescript
import { EventStream } from "../../event-stream";
import type { AssistantMessage } from "../../types";
import type { ProviderEvent, ProviderResult, StreamFunction } from "../types";

/** Create a mock StreamFunction that responds with the given message */
export function createMockStream(response: AssistantMessage): StreamFunction {
  return () => {
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return { message: event.message };
        throw (event as { type: "error"; error: Error }).error;
      },
    );
    queueMicrotask(() => {
      stream.push({ type: "start" });
      const text = response.content[0]?.type === "text" ? response.content[0].text : "";
      stream.push({ type: "text_delta", delta: text });
      stream.push({ type: "done", stopReason: response.stopReason, message: response });
    });
    return stream;
  };
}
```

### Step 8: 테스트 파일 업데이트 (17 files)

두 가지 패턴:

**패턴 A** — streamFn 직접 전달 (간단한 테스트):
```diff
 new Agent({
   ...BASE_CONFIG,
-  streamFactory: () => makeStreamFn(makeAssistant("hello")),
+  streamFn: makeStreamFn(makeAssistant("hello")),
 });
```

**패턴 B** — global resolver 사용 (integration 테스트):
```typescript
import { configureStreamResolver, resetStreamResolver } from "@diligent/core/llm/stream-resolver";

beforeEach(() => configureStreamResolver(() => mockStream));
afterEach(() => resetStreamResolver());
```

### Step 9: Export 업데이트

**File**: `packages/core/src/llm/index.ts` — `stream-resolver.ts` exports 추가
**File**: `packages/core/src/agent/index.ts` — 필요시 업데이트

## Files to Modify

| File | Change |
|------|--------|
| `packages/core/src/llm/stream-resolver.ts` | **NEW** — global resolver |
| `packages/core/src/llm/provider/mock.ts` | **NEW** — reusable mock stream |
| `packages/core/src/llm/index.ts` | Export stream-resolver, mock |
| `packages/core/src/agent/types.ts` | `streamFactory` → optional `streamFn` |
| `packages/core/src/agent/agent.ts` | Use `streamFn ?? resolveStream()` |
| `packages/core/src/agent/create-agent.ts` | Remove streamFactory wiring |
| `packages/runtime/src/config/runtime.ts` | Call `configureStreamResolver()` |
| `packages/runtime/src/app-server/factory.ts` | Remove `streamFactory` from AgentInit |
| `packages/runtime/src/collab/registry.ts` | Remove `streamFactory` from AgentInit |
| `packages/core/src/agent/__tests__/agent.test.ts` | `streamFn` direct injection |
| `packages/core/test/agent-loop.test.ts` | Update |
| `packages/core/test/agent-loop-retry.test.ts` | Update |
| `packages/core/test/agent-loop-steering.test.ts` | Update |
| `packages/runtime/src/session/__tests__/manager.test.ts` | Update |
| `packages/runtime/src/session/__tests__/steering.test.ts` | Update |
| `packages/runtime/src/rpc/__tests__/binding.test.ts` | Update |
| `packages/runtime/src/app-server/__tests__/server.test.ts` | Update |
| `packages/web/test/rpc-bridge.test.ts` | Update |
| `packages/web/test/server.integration.test.ts` | Update |
| `packages/e2e/helpers/server-factory.ts` | Update |
| `packages/cli/test/helpers/in-process-server.ts` | Update |

## Verification

1. `bun test packages/core/` — core 테스트 전체 통과
2. `bun test packages/runtime/` — runtime 테스트 전체 통과
3. `bun test packages/web/` — web 테스트 통과
4. `bun test packages/e2e/` — e2e 테스트 통과
5. `bun run build` — 빌드 성공 확인
6. 실제 실행 — CLI/Web에서 agent prompt 동작 확인
