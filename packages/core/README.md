# @diligent/core

Reusable engine primitives for Diligent.

This package owns provider abstraction, the agent loop, tool execution, auth helpers, and shared message/event types. It does not own Diligent-specific runtime assembly such as built-in tools, sessions, RPC, approval, or frontend wiring.

Tests are primarily under `test/`, with a smaller number of focused colocated tests in `src/**/__tests__/`.

## Structure

```text
src/
  agent/          Agent loop, assistant streaming, compaction helpers, loop safety
  auth/           API keys and OAuth token lifecycle
  llm/            Model registry, retry, provider manager, provider implementations
  tool/           Tool interface, registry, execution, truncation
  util/           Small shared helpers
  types.ts        Shared message/content/usage types
  event-stream.ts Async iterable stream primitive
```

## Key Patterns

- **AgentLoop**: stateless loop over immutable runtime config plus message history
- **EventStream**: async iterable for provider and agent events
- **Provider**: common `StreamFunction` interface dispatched by model/provider
- **Tool**: `{ name, description, parameters, execute(args, ctx) }`

## Boundary

Keep only reusable engine concerns here:

- provider abstraction and model registry
- agent loop and core events
- tool interfaces, execution, truncation
- auth primitives shared by provider management
- shared message and stream types

Move Diligent-specific runtime concerns to `packages/runtime`.
