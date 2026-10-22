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

## Tool-schema compatibility

`toToolInputSchema` produces the canonical object-shaped schema. Provider adapters own any
additional wire-format restrictions; tagging a schema with `type: "object"` alone does not
make every JSON Schema keyword acceptable to every provider.

Anthropic rejects `anyOf`, `oneOf`, and `allOf` at the tool input schema root. Its adapter
shares Gemini's object projection: resolve local references before merging root branches
into `properties` and `required`, retaining sibling fields. Alternative branches keep shared
required fields; `allOf` keeps every branch's requirements. Authored descriptions are
preserved, but raw schema JSON and generated structural explanations are not added to
`description`. Tool arguments remain visible as schema fields rather than description dumps.

OpenAI and ChatGPT share Responses schema adaptation: `oneOf` becomes `anyOf`, object nodes
gain an explicit `properties` map, and local `$ref` paths follow relocated branches.
This follows omp's non-strict Responses compatibility rules without enabling strict mode.
Union projection can widen acceptance; original execution-time validation remains authoritative.
Only schema-valued positions are visited, leaving property names and literal data in
`enum`, `const`, `default`, and `examples` untouched.

Gemini uses the same root object projection so the SDK does not mistake a composed schema
for a parameterless tool. Reference resolution and root adaptation apply regardless of
schema size or native web tools; size-driven pruning remains limited to native-web requests.

Vertex currently uses the OpenAI-compatible Chat Completions endpoint, as does Z.ai.
Neither path inherits Gemini or Responses schema restrictions just because of its provider name.

The canonical schema is not mutated, other providers keep their own adaptation policies,
and tool execution still uses the original `parameters` or `parseArgs` validation.

## Boundary

Keep only reusable engine concerns here:

- provider abstraction and model registry
- agent loop and core events
- tool interfaces, execution, truncation
- auth primitives shared by provider management
- shared message and stream types

Move Diligent-specific runtime concerns to `packages/runtime`.
