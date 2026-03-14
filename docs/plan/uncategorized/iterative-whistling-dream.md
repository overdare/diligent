# CustomModel → plain object + eager streamFn resolution

## Context

`CustomModel = Model & StreamFunction`은 JS의 "함수에 프로퍼티 붙이기" 트릭이라 테스트에서 `Object.assign(fn, TEST_MODEL)`처럼 어색하게 쓰인다. 사용자가 원하는 건 `{ ...TEST_MODEL, streamFn: fn }` 꼴의 plain object. 또한 현재 `_streamFn`은 `prompt()`/`compact()` 호출 시마다 lazy하게 resolve되는데, constructor에서 한 번에 끝내는 게 더 명확하다.

## Changes

### 1. `packages/core/src/agent/types.ts`

```ts
// Before
export type CustomModel = Model & StreamFunction;

// After
export type CustomModel = Model & { streamFn: StreamFunction };
```

### 2. `packages/core/src/agent/agent.ts`

**`resolveModelInput` 함수** — callable 체크 → `streamFn` 프로퍼티 체크:
```ts
function resolveModelInput(input: string | Model | CustomModel): { model: Model; streamFn?: StreamFunction } {
  if (typeof input === "string") return { model: resolveModel(input) };
  if ("streamFn" in input) return { model: input, streamFn: input.streamFn };
  return { model: input };
}
```

**Constructor** — streamFn을 eager하게 resolve:
```ts
// _streamFn을 non-optional로 변경
private _streamFn: StreamFunction;

// constructor에서:
const resolved = resolveModelInput(init.model);
this.model = resolved.model;
this._streamFn = resolved.streamFn ?? resolveStream(this.model.provider);
```

**`prompt()` / `compact()`** — lazy resolve 제거:
```ts
// Before
const streamFunction: StreamFunction = this._streamFn ?? resolveStream(this.model.provider);

// After
const streamFunction = this._streamFn;
```

**`setModel()`** — 새 모델로 바꿀 때도 streamFn 재resolve:
```ts
setModel(model: string | Model | CustomModel): void {
  const resolved = resolveModelInput(model);
  this.model = resolved.model;
  this._streamFn = resolved.streamFn ?? resolveStream(this.model.provider);
}
```
(현재 signature는 `string | CustomModel`인데, `Model`도 허용하도록 확장)

### 3. 테스트 파일들 — `Object.assign` 패턴 교체

`Object.assign(makeStreamFn(...), TEST_MODEL)` →  `{ ...TEST_MODEL, streamFn: makeStreamFn(...) }`

대상 파일:
- `packages/core/src/agent/__tests__/agent.test.ts`
- `packages/core/test/agent-loop.test.ts`
- `packages/core/test/agent-loop-retry.test.ts`
- `packages/core/test/agent-loop-steering.test.ts`
- `packages/runtime/src/app-server/__tests__/server.test.ts`
- `packages/runtime/src/rpc/__tests__/binding.test.ts`
- `packages/runtime/src/session/__tests__/manager.test.ts`
- `packages/runtime/src/session/__tests__/steering.test.ts`
- `packages/web/test/rpc-bridge.test.ts`
- `packages/web/test/server.integration.test.ts`

## Verification

```bash
bun test packages/core
bun test packages/runtime
bun test packages/web
```
