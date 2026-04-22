---
id: P066
status: backlog
created: 2026-04-22
---

# Vertex AI Gemma Provider Integration

## Goal

Add a Google Vertex AI path that lets Diligent use Gemma models hosted through Vertex AI Model Garden, with runtime-managed configuration, provider selection, and model metadata that behave consistently across Web, TUI, and the shared protocol.

After this work, a user can authenticate Diligent against Vertex AI, select a Vertex-backed Gemma model, and run ordinary coding-agent turns without having to fork the existing Gemini provider flow or hand-patch provider internals.

This detailed design is now **locked** to the following integration path:

- **Provider name:** `vertex`
- **Primary API path:** Vertex AI **OpenAI-compatible Chat Completions endpoint**
- **Initial model scope:** Vertex-hosted Gemma models reachable through Model Garden / deployed Vertex endpoints
- **Initial auth mode:** **short-lived Google Cloud access token** obtained from ADC or explicit access-token configuration
- **Normalization strategy:** reuse Diligent's existing OpenAI-compatible plumbing where possible, but add a Vertex-specific adapter rather than pretending Vertex is ordinary `openai`

## Prerequisites

- `@diligent/core` provider abstraction remains the single integration point for model streaming and provider-specific normalization.
- `@diligent/runtime` remains the owner of auth/config loading and `ProviderManager` wiring.
- `@diligent/protocol` remains the canonical contract for provider names and provider-native content blocks.
- Existing Gemini provider support through `@google/genai` remains intact and must continue to work unchanged during rollout.

## Artifact

The user can configure Vertex AI, choose a Vertex-backed Gemma model, and run a normal turn from either Web or TUI.

```text
User → configures Vertex AI project/region/credentials and selects a Vertex Gemma model
Agent → routes the request through a Vertex provider implementation
Agent → streams assistant text/tool calls normally and completes the turn with standard Diligent events
```

Concrete operator flow:

```text
User → sets Vertex credentials in config/auth
User → selects model "vertex-gemma-4-26b-it"
User → asks "summarize this repo and propose a refactor plan"
Agent → streams response and tool usage through the same transcript/event model used by other providers
```

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| `packages/core/src/llm/provider/` | Add a Vertex AI provider implementation for Gemma-capable Model Garden usage and normalized event mapping |
| `packages/core/src/llm/provider-manager.ts` | Register the new provider, auth/baseUrl wiring, defaults, hints, and stream dispatch |
| `packages/core/src/llm/models.ts` | Add Vertex-backed Gemma model definitions, aliases, and capability metadata |
| `packages/runtime/src/config/` | Extend runtime config schema and loader for Vertex project/region/auth settings |
| `packages/runtime/src/auth/` | Extend auth persistence only if the chosen auth shape requires durable secrets beyond config/env |
| `packages/protocol/src/` | Add provider enum support and widen provider-native block schemas where provider identity is enumerated |
| `packages/cli` + `packages/web` | Inherit provider list/model availability updates without introducing client-specific provider logic |
| `docs/guide/` | Document Vertex AI configuration and operator workflow |
| `packages/*/test/` | Add provider-manager, config, and model-resolution coverage for Vertex |

### What does NOT change

- No replacement of the existing `gemini` provider path that uses Gemini API / AI Studio-style API keys.
- No attempt to unify Vertex and Gemini under one overloaded provider name in this plan.
- No deployment automation for self-hosted GPU endpoints in Vertex Model Garden.
- No fine-tuning, custom weights import, or endpoint lifecycle management.
- No ChatGPT-style OAuth browser flow unless later investigation proves Vertex cannot be integrated cleanly with ADC/service-account based auth.
- No provider-specific UI redesign; Web and TUI should consume the shared provider/protocol updates only.

## Recommended approach

This plan recommends **introducing a distinct provider name** such as `vertex` rather than extending the current `gemini` provider to cover Vertex AI.

Why:

1. **Auth is materially different.** Current `gemini` assumes an API-key model (`GEMINI_API_KEY` / AI Studio key), while Vertex AI typically requires project/region scoping and Google Cloud credentials.
2. **Operational shape is different.** Vertex AI Model Garden Gemma access is tied to Google Cloud project configuration and, for many paths, deployed or managed model endpoints rather than a simple public API key.
3. **Current architecture already treats provider identity as meaningful.** Provider names are exposed in protocol, runtime auth status, CLI/Web provider management, and model metadata.
4. **Keeping `gemini` intact minimizes regression risk** for current users.

The main alternative is to treat Vertex as a transport variant of `gemini`, but that would force unrelated auth/config complexity into a provider that currently has a simple API-key contract.

## Locked design decisions

### D1. Provider identity

Use **`vertex`** as the canonical provider token.

Rationale:

- short and unambiguous,
- consistent with other provider tokens,
- avoids overloading `gemini`,
- avoids leaking Google product naming variants (`vertexai`, `google-vertex`) across protocol/runtime/UI.

### D2. API strategy

Use the Vertex AI **OpenAI-compatible Chat Completions endpoint** for the first implementation, not the Google Gen AI SDK and not a custom Gemini-only integration path.

Concretely, Diligent will target a base URL shaped like:

```text
https://{location}-aiplatform.googleapis.com/v1beta1/projects/{project}/locations/{location}/endpoints/{endpoint}
```

where:

- `endpoint = openapi` for Vertex's OpenAI-compatible managed path when applicable,
- or `endpoint = {deployed_endpoint_id}` for self-deployed Model Garden endpoints.

Rationale:

- Diligent already has strong OpenAI-compatible request/stream normalization logic.
- Google officially documents the OpenAI-compatible path for Vertex AI.
- This minimizes provider-specific parser surface while preserving a distinct provider boundary.

### D3. Supported auth modes

The first implementation supports these auth modes, in priority order:

1. **`access_token_command`** — execute a local command that returns a fresh bearer token, e.g. `gcloud auth application-default print-access-token`
2. **`access_token`** — static or externally injected access token string
3. **`adc`** — future-friendly config label, but **implemented initially as a command-backed token refresh path**, not direct Google-auth library integration

Deferred:

- embedded service-account JSON parsing,
- direct workload identity / metadata server logic in runtime,
- browser-based OAuth managed by Diligent.

Rationale:

- Vertex OpenAI-compatible auth is documented around **short-lived OAuth access tokens**.
- Current core/runtime dependency set does not yet include Google auth libraries for direct token refresh.
- Command-based token acquisition fits current runtime patterns and avoids adding a large auth dependency in the first pass.

### D4. Endpoint contract

The initial `vertex` provider config requires:

- `project`
- `location`
- `endpoint`
- one auth mode

`endpoint` accepts either:

- the literal `openapi`, or
- a deployed Vertex endpoint ID for self-deployed Model Garden models.

This design intentionally **does not** attempt to auto-discover endpoints from Model Garden.

### D5. Model registration strategy

The registry will expose **Diligent-owned stable model IDs** for Vertex models and keep any raw upstream deployment identifier in provider-specific metadata.

Example:

- Diligent model id: `vertex-gemma-4-26b-it`
- runtime provider metadata: raw publisher/deployment details if needed later

Rationale:

- avoids leaking unstable deployment internals into every UX surface,
- preserves the ability to remap aliases later,
- keeps `resolveModel()` deterministic.

### D6. Tool-calling and reasoning scope

The initial implementation supports:

- normal text streaming,
- ordinary function/tool calling if the selected Vertex endpoint supports OpenAI-compatible tool calling.

The initial implementation does **not** support:

- provider-native web search blocks,
- OpenAI Responses-specific reasoning payload features,
- native compaction.

Rationale:

- Google documents Vertex's **Chat Completions** compatibility path, not Diligent's existing OpenAI **Responses API** feature set.
- Diligent's `openai-shared.ts` currently contains Responses-specific request fields and event handling; these must be capability-gated or bypassed for Vertex.

## Finalized architecture

### Provider design

Vertex is implemented as a **distinct external-auth provider** in `ProviderManager`, similar in spirit to `chatgpt`, but without browser OAuth.

High-level flow:

1. runtime loads `provider.vertex` config
2. runtime builds a `VertexAccessTokenBinding`
3. binding exposes `isConfigured()`, `getMaskedKey()`, `ensureFresh()`, and `getStream()`
4. `ProviderManager` dispatches `vertex` models through that binding
5. `vertex.ts` sends OpenAI-compatible Chat Completions requests to the configured Vertex endpoint
6. Vertex SSE/chat deltas are normalized into Diligent `ProviderEvent`s

### Reuse strategy

Do **not** wire Vertex directly into `openai.ts`, because current OpenAI support is built around the **Responses API** request/event contract.

Instead:

- keep `openai-shared.ts` as a source of reusable message/tool mapping utilities where applicable,
- add a new helper dedicated to **OpenAI-compatible Chat Completions** request/stream translation,
- let both Vertex and any future OpenAI-compatible providers reuse that helper.

Recommended new helper file:

- `packages/core/src/llm/provider/openai-compatible.ts`

That helper should own:

- conversion from Diligent `Message[]` to OpenAI-compatible `messages`,
- conversion from Diligent function tools to Chat Completions `tools`,
- SSE delta parsing for chat-completions streaming,
- stop-reason and usage mapping for chat-completions payloads.

## Concrete config design

### Runtime config

```typescript
const VertexProviderConfigSchema = z
  .object({
    project: z.string().min(1),
    location: z.string().min(1),
    endpoint: z.string().min(1),
    baseUrl: z.string().url().optional(),
    authMode: z.enum(["access_token_command", "access_token", "adc"]).optional(),
    accessToken: z.string().optional(),
    accessTokenCommand: z.string().optional(),
    modelMap: z.record(z.string(), z.string()).optional(),
  })
  .optional();
```

Config rules:

- `project`, `location`, and `endpoint` are required whenever `provider.vertex` is present.
- `baseUrl` is optional and usually derived.
- `authMode` defaults to `access_token_command` when `accessTokenCommand` is present.
- `modelMap` is optional and allows operator-side mapping from Diligent model IDs to deployed endpoint model identifiers if a deployment requires it later.

### Derived base URL

If `baseUrl` is absent, runtime derives:

```typescript
function buildVertexBaseUrl(project: string, location: string, endpoint: string): string {
  return `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${project}/locations/${location}/endpoints/${endpoint}`;
}
```

### Auth resolution

```typescript
export interface VertexResolvedAuth {
  accessToken: string;
  expiresAt?: number;
}

export interface VertexAccessTokenBinding {
  auth: ExternalProviderAuth;
  refresh: () => Promise<void>;
  getToken: () => string | undefined;
}
```

Implementation rules:

- `access_token_command` executes on demand and trims stdout.
- returned token is cached in memory with a conservative TTL when explicit expiry is unknown.
- `ensureFresh()` is responsible for refreshing before expiry.
- `getStream()` must read the current token lazily so it never closes over a stale token.

Because `ProviderManager` currently triggers `ensureFresh()` without awaiting it, the Vertex binding must be robust against that behavior by making `getStream()` consult the latest token supplier rather than embedding a token value at bind time.

## File Manifest

### packages/core/src/llm/

| File | Action | Description |
|------|--------|------------|
| `provider/openai-compatible.ts` | CREATE | Shared request/stream helpers for OpenAI-compatible Chat Completions providers |
| `provider/vertex.ts` | CREATE | Vertex AI stream implementation and error classification |
| `provider-manager.ts` | MODIFY | Register Vertex provider, auth wiring, hints, defaults, and dispatch |
| `models.ts` | MODIFY | Add Vertex Gemma models and alias resolution metadata |
| `types.ts` | MODIFY | Widen provider-name unions if they are core-owned here |
| `index.ts` | MODIFY | Export Vertex provider symbols through barrel files if needed |

### packages/runtime/src/config/

| File | Action | Description |
|------|--------|------------|
| `schema.ts` | MODIFY | Add Vertex provider configuration fields |
| `runtime.ts` | MODIFY | Load Vertex auth/config and bind into `ProviderManager` |
| `loader.ts` | MODIFY | Ensure new provider fields participate in config merge/substitution correctly if needed |

### packages/runtime/src/auth/

| File | Action | Description |
|------|--------|------------|
| `provider-auth.ts` | MODIFY | Add a Vertex external-auth binding backed by access-token refresh |

### packages/runtime/src/tools/

| File | Action | Description |
|------|--------|------------|
| `defaults`-adjacent files if needed | MODIFY | Add any helper needed for safe token-command execution only if runtime decides to centralize command handling |

### packages/protocol/src/

| File | Action | Description |
|------|--------|------------|
| `data-model.ts` | MODIFY | Extend canonical provider enum/schema |
| `content-blocks.ts` | MODIFY | Widen provider enum literals for provider-native blocks if Vertex emits them |

### packages/cli/src/

| File | Action | Description |
|------|--------|------------|
| `**/*provider*` or related TUI files | MODIFY | Surface Vertex in provider selection/help if client logic enumerates providers locally |

### packages/web/src/

| File | Action | Description |
|------|--------|------------|
| `**/*provider*` or related client files | MODIFY | Surface Vertex in provider management UI if client logic enumerates providers locally |

### docs/guide/

| File | Action | Description |
|------|--------|------------|
| `provider-auth.md` | MODIFY | Document Vertex auth/config semantics and operator flow |
| `vertex-ai.md` or similar | CREATE | Optional focused guide for Vertex setup and model selection |

### packages/core/test/ or packages/runtime/test/

| File | Action | Description |
|------|--------|------------|
| `packages/core/test/llm/provider/models.test.ts` | MODIFY | Verify Vertex model resolution, aliases, and class coverage |
| `packages/runtime/test/config/runtime.test.ts` | MODIFY | Verify config loading and first-available-model selection for Vertex |
| `packages/runtime/test/auth/auth-store.test.ts` | MODIFY | Only if any persisted Vertex secret path is introduced |
| `packages/cli/test/provider-manager.test.ts` | MODIFY | Verify provider name/default hint visibility where CLI mirrors provider-manager state |

## Implementation Tasks

### Task 1: Lock the provider contract and naming

**Files:** `packages/protocol/src/data-model.ts`, `packages/core/src/llm/provider-manager.ts`, `packages/core/src/llm/types.ts`, `packages/protocol/src/content-blocks.ts`
**Decisions:** D003, D004

Introduce a distinct provider identity for Vertex AI and propagate it through the core/provider/protocol enums that currently hardcode `anthropic | openai | chatgpt | gemini`.

Code sketch:

```typescript
export const ProviderNameSchema = z.enum(["anthropic", "openai", "chatgpt", "gemini", "vertex"]);
export type ProviderName = z.infer<typeof ProviderNameSchema>;

export const PROVIDER_NAMES: ProviderName[] = ["anthropic", "openai", "chatgpt", "gemini", "vertex"];

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5.3-codex",
  chatgpt: "chatgpt-5.3-codex",
  gemini: "gemini-2.5-flash",
  vertex: "vertex-gemma-4-26b-it",
};
```

Rules:

- Choose a single provider token and use it everywhere.
- Do not repurpose `gemini` to mean both AI Studio and Vertex.
- Only widen provider-native block enums if Vertex actually emits those block types.

**Verify:** provider enum/schema compiles across protocol, core, runtime, and any client/provider-management surfaces without string drift.

### Task 2: Define the Vertex auth/config contract

**Files:** `packages/runtime/src/config/schema.ts`, `packages/runtime/src/config/runtime.ts`, `packages/runtime/src/auth/auth-store.ts`, `docs/guide/provider-auth.md`
**Decisions:** D032, D033, D034

Add a dedicated Vertex provider config section rather than squeezing project/region/credential settings into the existing Gemini API-key shape.

Locked initial contract:

- project ID
- region/location
- endpoint ID (`openapi` or deployed endpoint id)
- optional base URL override
- auth mode `access_token_command | access_token | adc`
- optional token string or token command
- optional `modelMap`

Code sketch:

```typescript
const VertexProviderConfigSchema = z.object({
  project: z.string().min(1),
  location: z.string().min(1),
  endpoint: z.string().min(1),
  baseUrl: z.string().url().optional(),
  authMode: z.enum(["access_token_command", "access_token", "adc"]).optional(),
  accessToken: z.string().optional(),
  accessTokenCommand: z.string().optional(),
  modelMap: z.record(z.string(), z.string()).optional(),
});

provider: z.object({
  anthropic: ...,
  openai: ...,
  gemini: ...,
  vertex: VertexProviderConfigSchema.optional(),
}).optional();
```

Implementation notes:

- Do not persist Vertex access tokens in `auth.jsonc` in the first implementation.
- Keep Vertex credentials/config project-local in `config.jsonc` plus environment or command indirection.
- `adc` is accepted as a user-facing mode name, but the initial implementation may internally normalize it to the default token-command strategy until direct Google-auth dependency support is added.

**Verify:** runtime can load a valid Vertex config, derive provider availability correctly, and fail with actionable errors when project/location/auth is incomplete.

### Task 3: Implement a Vertex streaming adapter for Gemma

**Files:** `packages/core/src/llm/provider/openai-compatible.ts`, `packages/core/src/llm/provider/vertex.ts`, `packages/core/src/llm/provider-manager.ts`
**Decisions:** D003, D007, D009, D010

Create a new `StreamFunction` implementation that converts Vertex AI Chat Completions responses into Diligent's normalized provider events.

This provider should **not** reuse `openai.ts` directly. Instead it should reuse a new OpenAI-compatible Chat Completions helper layer.

Code sketch:

```typescript
export interface VertexClientConfig {
  project: string;
  location: string;
  endpoint: string;
  baseUrl?: string;
  getAccessToken: () => Promise<string>;
  modelMap?: Record<string, string>;
}

export function createVertexStream(config: VertexClientConfig): StreamFunction {
  return (model, context, options) => {
    const stream = new EventStream<ProviderEvent, ProviderResult>(...);
    // Build OpenAI-compatible chat-completions request
    // Send SSE request with Authorization: Bearer <access token>
    // Translate chat deltas/tool calls → normalized ProviderEvent
    return stream;
  };
}

export function classifyVertexError(err: unknown): ProviderError {
  // map auth, quota, overloaded, context, network
}
```

Requirements:

- Preserve existing `tool_call_start` / `tool_call_end` semantics when Vertex supports function calling.
- Normalize usage and stop reason when available from chat-completions payloads.
- Keep retries/error classification compatible with the existing provider model.
- Do not send Responses-only fields such as `reasoning.encrypted_content`, `prompt_cache_retention`, or provider-native web tools.
- No native compaction in phase 1.

**Verify:** provider stream emits valid normalized events for text-only and tool-call turns, and surfaces auth/quota errors as classified provider errors.

### Task 4: Register Vertex-backed Gemma models cleanly

**Files:** `packages/core/src/llm/models.ts`, `packages/core/test/llm/models.test.ts`
**Decisions:** D003

Add explicit Vertex-backed model entries for the Gemma variants Diligent intends to support first. Do not rely on ad-hoc prefix inference alone.

The first implementation should stay narrow: one recommended default plus a small supported set that has verified Vertex availability.

Code sketch:

```typescript
{
  id: "vertex-gemma-4-26b-it",
  provider: "vertex",
  contextWindow: 256_000,
  maxOutputTokens: 8_192,
  supportsThinking: false,
  supportsVision: false,
  aliases: ["vertex-gemma", "gemma-vertex", "gemma-4-26b-it-vertex"],
  modelClass: "general",
}
```

Initial recommended registry set:

- `vertex-gemma-4-26b-it` → general

If the chosen Vertex deployment inventory is intentionally unified to a single model family, phase 1 may keep one registered model and let class-based resolution remain on that same model instead of forcing one model per class.

**Verify:** `resolveModel()` returns Vertex models deterministically, aliases resolve correctly, and provider-specific class switching does not accidentally fall back to `gemini`.

### Task 5: Wire provider availability through runtime and clients

**Files:** `packages/runtime/src/config/runtime.ts`, `packages/runtime/src/auth/provider-auth.ts`, `packages/runtime/src/app-server/config-handlers.ts`, `packages/cli/src/**/*`, `packages/web/src/**/*`, `packages/runtime/test/config/runtime.test.ts`
**Decisions:** D004, D032, D033

Ensure Vertex appears anywhere Diligent exposes provider availability or provider hints, without introducing duplicated business logic in Web/TUI.

Code sketch:

```typescript
const providerManager = new ProviderManager({
  provider: {
    anthropic: config.provider?.anthropic,
    openai: config.provider?.openai,
    gemini: config.provider?.gemini,
    vertex: config.provider?.vertex,
  },
});

if (isVertexConfigured(config.provider?.vertex)) {
  providerManager.setExternalAuth("vertex", createVertexAccessTokenBinding(config.provider.vertex).auth);
}
```

This task also updates:

- provider hints/help text shown in configuration flows,
- provider status reporting so `vertex` shows as configured when the runtime config is sufficient,
- auth UI wording so Vertex is presented as config/token-command based rather than API-key or browser-OAuth based.

**Verify:** Web and TUI both list Vertex as an available provider when configured, and selected Vertex models survive thread resume/model-change flows.

### Task 6: Document and test the end-to-end contract

**Files:** `docs/guide/provider-auth.md`, `docs/guide/vertex-ai.md`, relevant provider/config tests
**Decisions:** D003, D032, D033

Document the exact operator setup flow and pin the supported auth path explicitly. The guide must explain the difference between:

- existing `gemini` provider (Gemini API / API key)
- new `vertex` provider (Google Cloud / Vertex AI project-scoped access)

The guide must also include a concrete local-development setup example:

```text
gcloud auth application-default login
gcloud auth application-default print-access-token
```

and a sample `config.jsonc` snippet showing `project`, `location`, `endpoint`, and `accessTokenCommand`.

Testing should cover:

- config parsing,
- provider registration,
- available model selection,
- auth error messaging,
- model alias resolution.

**Verify:** a new contributor can follow the guide to understand which provider to use, which credentials are needed, and how to select a Vertex Gemma model without reading source code.

## Acceptance Criteria

1. Diligent exposes a distinct Vertex provider identity without breaking existing `gemini` behavior.
2. Runtime config can represent Vertex project/location/auth requirements without overloading the Gemini API-key schema.
3. A Vertex provider implementation exists and emits normalized Diligent provider events for supported Chat Completions request paths.
4. At least one Vertex-backed Gemma model is registered with explicit metadata and alias coverage.
5. Web and TUI surface Vertex provider availability through the shared runtime/protocol path, not client-specific logic.
6. Provider/config/model tests cover the new path and existing provider tests still pass.
7. Documentation clearly distinguishes Gemini API usage from Vertex AI Gemma usage.

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | Provider enum and model resolution | `bun test` against protocol/core model tests |
| Unit | Vertex config parsing and availability selection | Runtime config tests with representative configs |
| Unit | Vertex stream normalization | Mock/provider fixture tests for chat-completions text, tool calls, and auth/quota errors |
| Integration | ProviderManager → runtime → selected model flow | Focused runtime/provider integration test |
| Manual | Real Vertex project smoke test | Configure a live Vertex project and run one text-only and one tool-using turn against `openapi` or a deployed endpoint |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Vertex auth does not fit current API-key-first assumptions | Runtime/provider wiring becomes awkward or leaky | Keep Vertex as a separate provider with its own config contract |
| Access token refresh races with current non-awaited `ensureFresh()` flow | First request after expiry may fail | Make Vertex binding lazily fetch current token inside `getStream()` and cache conservatively |
| Exact deployed Gemma model inventory differs by region/project | Model registry may over-promise | Keep default registry small and document region-specific verification |
| Vertex Chat Completions differs from OpenAI Responses semantics | Direct reuse of `openai.ts` would break fields/events | Introduce dedicated `openai-compatible.ts` helper instead of piggybacking on Responses logic |
| Provider names are duplicated across layers | Type/runtime drift across protocol, runtime, and clients | Start with provider enum unification as Task 1 |
| Vertex tool-calling semantics differ from Gemini API semantics | Tool normalization may be incomplete on first pass | Explicitly prototype text-only first, then tool-call parity before default rollout |
| Model IDs or availability change over time | Hardcoded registry becomes stale | Keep supported set intentionally small and document source-of-truth update procedure |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D003 | Provider abstraction from day one | Provider split, stream adapter, model registration |
| D004 | Tagged event model for agent communication | Normalized provider events and client/runtime compatibility |
| D007 | Custom async iterable EventStream | Vertex streaming adapter shape |
| D009 | AbortController-based cancellation | Vertex request cancellation wiring |
| D010 | Retryable vs non-retryable error classification | Vertex error mapping |
| D032 | JSONC + Zod config validation | Vertex config schema |
| D033 | Config hierarchy with precedence | Runtime/provider config loading |
| D034 | Deep merge config strategy | Vertex provider config merge behavior |
