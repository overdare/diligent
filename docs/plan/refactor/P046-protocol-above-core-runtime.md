---
id: P046
title: Lift protocol above core and runtime
type: refactor
status: proposed
owner: diligent
created: 2026-03-13
---

# Summary

After splitting `packages/core` and `packages/runtime`, the current dependency direction is still:

```text
@diligent/protocol -> @diligent/core -> @diligent/runtime -> clients
```

The desired architecture is:

```text
@diligent/core -> @diligent/runtime -> @diligent/protocol -> @diligent/cli, @diligent/web
```

In this target shape, `@diligent/protocol` becomes the external boundary package for frontend/server communication and should stop being a foundational dependency of the engine.

## Goal

Make `packages/core` and `packages/runtime` stop depending directly on `@diligent/protocol`, while preserving the current JSON-RPC surface for CLI/Web/Desktop.

## Current State

### `packages/core` still imports protocol for three kinds of things

1. **Provider metadata and auth enums**
   - `provider/provider-manager.ts`
   - `provider/models.ts`
   - `provider/thinking-effort.ts`
   - `auth/auth-store.ts`
   - imports: `ProviderName`, `ModelInfo`

2. **Tool/UI render payload types**
   - `tool/types.ts`
   - `tool/executor.ts`
   - `types.ts`
   - imports: `ToolRenderPayload`, `ToolRenderPayloadSchema`

3. **Version constant / protocol re-export**
   - `provider/chatgpt.ts` imports `DILIGENT_VERSION`
   - `index.ts` re-exports the whole protocol bundle

### `packages/runtime` still imports protocol for boundary concerns

1. **JSON-RPC wire types and method constants**
   - `rpc/*`
   - `app-server/server.ts`
   - `app-server/server-requests.ts`

2. **Notification/request mapping**
   - `notification-adapter.ts`
   - `app-server/event-mapper.ts`

3. **Boundary payloads for tool state, auth state, knowledge APIs**
   - `app-server/config-handlers.ts`
   - `app-server/knowledge-handlers.ts`
   - `app-server/thread-handlers.ts`

This runtime usage is boundary-oriented and is much closer to the intended final shape than core's current dependency.

## Target Boundary

### `@diligent/core`

Own only reusable engine primitives:

- provider registry and provider names
- model metadata used by the engine
- agent loop and events
- tool interfaces and execution
- auth primitives required by provider management
- shared message and render-neutral types

`core` must not import JSON-RPC schemas or frontend-facing protocol types.

### `@diligent/runtime`

Own Diligent-specific runtime assembly:

- sessions and persistence
- app-server and RPC runtime binding
- built-in tools
- config / knowledge / skills / approval / collab
- adapters between engine types and protocol types

`runtime` may temporarily remain the only package that knows both engine types and protocol types, but that dependency should be localized to adapter modules rather than spread across the whole package.

### `@diligent/protocol`

Own only external boundary contracts:

- JSON-RPC request/response/notification schemas
- transport-facing enums and payload shapes
- client/server-facing render payloads
- web/TUI shared DTOs

Protocol should describe what crosses the boundary, not what powers the engine internally.

## Minimal Refactor Path

### Phase 1 — remove direct protocol dependency from core

1. **Move provider metadata into core**
   - define `ProviderName` in core provider types
   - define engine-owned model metadata shape in core
   - make `provider/models.ts` canonical
   - protocol can later derive/export its own DTO shape from runtime adapters

2. **Move render payload types out of protocol dependency path**
   - create a core-owned render payload type/schema module for tool results
   - keep the runtime/protocol wire representation identical for now
   - adapt at the boundary instead of importing protocol directly in core

3. **Remove protocol re-export from core**
   - `packages/core/src/index.ts` should not expose `protocol`

4. **Move version constant access out of core**
   - stop importing `DILIGENT_VERSION` from protocol in provider code
   - inject version from runtime or a neutral shared version module

### Phase 2 — localize protocol usage inside runtime

1. Add `packages/runtime/src/protocol/` adapter modules
2. Concentrate all `@diligent/protocol` imports there
3. Make `rpc/*`, `app-server/*`, and `notification-adapter.ts` consume those adapters
4. Keep business logic in session/tools/config layers protocol-agnostic where possible

### Phase 3 — make clients depend on protocol as the top boundary

1. `cli` and `web` consume wire types from `@diligent/protocol`
2. `cli` and `web` consume runtime services from `@diligent/runtime`
3. `core` remains invisible to clients except for tests or engine-only consumers

## Non-Goals

- Do not redesign the external JSON-RPC protocol in this refactor
- Do not rename major user-facing concepts
- Do not split render payloads into a separate package unless localization inside runtime proves insufficient

## Success Criteria

- `packages/core` has zero direct imports from `@diligent/protocol`
- `packages/runtime` contains the only protocol adapters
- `@diligent/protocol` is clearly documented as the external boundary package
- build and test remain green

## Notes

This is a second-stage architectural cleanup after the `core` / `runtime` split. The first split established package ownership. This refactor corrects the layering direction so the protocol stops leaking downward into the engine.
