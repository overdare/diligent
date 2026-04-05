---
id: P061
status: backlog
created: 2026-04-05
---

# P061: Provider-Native Websearch + Webfetch

## Goal

Add first-class `websearch` and `webfetch` support to Diligent as built-in tools that resolve to provider-native implementations for OpenAI, ChatGPT, and Anthropic.

After this work, users can enable and use `websearch` and `webfetch` in normal Diligent sessions while the runtime transparently delegates execution to the active provider’s native web tools, preserving citations, sources, and provider-executed results in the shared protocol and session transcript.

Inside Diligent, both the request contract and the response contract are normalized:

- request-side built-in capabilities are always `websearch` and `webfetch`
- response-side transcript blocks are always normalized Diligent web result shapes

Provider adapters own the translation between those normalized Diligent contracts and each provider’s native API shape.

## Prerequisites

- Existing provider abstraction in `packages/core/src/llm/` and `ProviderManager` (D003)
- Existing built-in tool catalog and tool metadata flow in `packages/runtime/src/tools/`
- Existing protocol-owned message/content schemas in `packages/protocol/src/data-model.ts`
- Existing OpenAI/ChatGPT Responses integrations in `packages/core/src/llm/provider/openai*.ts` and `chatgpt.ts`
- Existing Anthropic streaming/tool integration in `packages/core/src/llm/provider/anthropic.ts`

## Planning Assumptions

- `websearch` and `webfetch` are exposed to users as stable Diligent built-in tool names regardless of provider-specific upstream naming.
- OpenAI and ChatGPT both use the Responses-style provider path already present in the repo; this plan does not add chat/completions-only web tool handling.
- Diligent owns a normalized internal contract for both request and response handling. Provider-native request types and response item types do not escape adapter boundaries.
- OpenAI and ChatGPT may map normalized `webfetch` to native web-search-family actions such as `open_page` and `find_in_page` if no separate native fetch tool exists.
- Anthropic dynamic-filtering variants (`*_20260209`) are only used when code execution is available; otherwise the non-dynamic versions are used.
- UI work in this phase is limited to minimal, reliable rendering using existing assistant-message surfaces.

## Architectural Position

This plan chooses a stricter architecture than “native request, normalized response”.

### Request contract is normalized

Runtime tool catalog, assistant assembly, policies, and tests should talk about:

- `websearch`
- `webfetch`

They should not talk directly about provider-native request concepts such as:

- `web_search_20260209`
- `web_fetch_20250910`
- `open_page`
- `find_in_page`

Those belong inside provider adapters only.

### Response contract is normalized

Provider-native result items should be converted into shared protocol-level blocks before they hit:

- persistence
- thread reads
- Web rendering
- TUI rendering

### Provider-native shapes stay at the edge

Provider-specific request and response quirks remain adapter concerns. The rest of Diligent should only see the normalized Diligent-native web contracts introduced by this plan.

## Artifact

Users can demonstrate provider-native web tools from the normal Diligent chat surface without installing extra plugins or switching to provider-specific modes.

Example:

```text
User → "Search for the latest Bun 1.x release notes and summarize breaking changes."
Agent → uses built-in `websearch` through the active provider’s native web tool
Agent → responds with an answer that includes preserved source/citation data

User → "Fetch the release notes page you found and extract the migration steps."
Agent → uses built-in `webfetch` through the active provider’s native web tool
Agent → responds with extracted content and preserved fetch/citation metadata
```

For Anthropic-backed sessions, provider-executed server-tool blocks and citation payloads are persisted in the transcript. For OpenAI/ChatGPT-backed sessions, native Responses web tool requests and returned sources are also preserved instead of being flattened into ad hoc text.

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| `packages/protocol/src/data-model.ts` | Extend shared content/message schemas to represent provider-executed web tool use, search/fetch results, and citations |
| `packages/core/src/llm/types.ts` | Extend provider-facing tool definitions with normalized Diligent web tool definitions |
| `packages/core/src/agent/assistant.ts` | Map runtime `websearch` / `webfetch` built-ins into normalized Diligent web tool definitions instead of local function tools |
| `packages/core/src/llm/provider/openai-shared.ts` | Translate normalized Diligent web tool definitions into OpenAI-native payloads and parse OpenAI-native responses back into normalized blocks |
| `packages/core/src/llm/provider/openai.ts` | Send OpenAI-native web payloads derived from normalized Diligent contracts |
| `packages/core/src/llm/provider/chatgpt.ts` | Mirror OpenAI Responses mapping for ChatGPT OAuth-backed requests |
| `packages/core/src/llm/provider/anthropic.ts` | Translate normalized Diligent web tool definitions into Anthropic server-tool payloads and parse native server-tool results/citations back into normalized blocks |
| `packages/runtime/src/tools/defaults.ts` | Register `websearch` and `webfetch` as runtime built-ins |
| `packages/runtime/src/tools/tool-metadata.ts` | Mark new tools as normalized web built-ins and expose them through catalog/UI metadata |
| `packages/runtime/src/app-server/thread-read-builder.ts` and related session plumbing | Ensure provider-executed web result blocks survive persistence, replay, and thread reads |
| `packages/web/src/client/lib/thread-store.ts` + adjacent helpers | Render the new normalized web blocks and citation-bearing text blocks with a safe minimal presentation |
| `packages/cli/src/tui/components/thread-store.ts` + adjacent helpers | Render the new normalized web blocks and citation-bearing text blocks with a safe minimal presentation |
| `packages/core/test` / `packages/runtime/test` / frontend tests | Add targeted provider/tool parsing and rendering coverage |

### What does NOT change

- No local HTTP-based fallback implementation for `websearch` or `webfetch` in this plan
- No plugin-based web tool implementation path in this plan
- No new provider support beyond OpenAI, ChatGPT, and Anthropic
- No advanced provider-specific settings UI beyond minimal visibility of new built-ins
- No new user-facing config schema for per-tool web options in this phase; defaults live in runtime/provider mapping code
- No attempt to fully redesign the transcript UI for rich citations beyond minimal safe rendering
- No generalized provider-native tool framework for every future built-in tool; this plan only creates the normalized abstraction needed for `websearch` and `webfetch`

## File Manifest

### packages/protocol/src/

| File | Action | Description |
|------|--------|------------|
| `data-model.ts` | MODIFY | Add normalized web result content blocks and citation schemas |

### packages/core/src/llm/

| File | Action | Description |
|------|--------|------------|
| `types.ts` | MODIFY | Extend `ToolDefinition`, normalized web tool request types, provider events, and related stream types |

### packages/core/src/agent/

| File | Action | Description |
|------|--------|------------|
| `assistant.ts` | MODIFY | Convert built-in web tools into normalized Diligent web tool definitions |

### packages/core/src/llm/provider/

| File | Action | Description |
|------|--------|------------|
| `openai-shared.ts` | MODIFY | Map normalized Diligent web tools to/from OpenAI-native web-search-family payloads |
| `openai.ts` | MODIFY | Send/receive OpenAI-native payloads derived from normalized web tool definitions |
| `chatgpt.ts` | MODIFY | Send/receive ChatGPT-native payloads derived from normalized web tool definitions |
| `anthropic.ts` | MODIFY | Map normalized Diligent web tools to/from Anthropic-native server-tool payloads |

### packages/runtime/src/tools/

| File | Action | Description |
|------|--------|------------|
| `defaults.ts` | MODIFY | Register `websearch` and `webfetch` in the built-in catalog |
| `tool-metadata.ts` | MODIFY | Mark normalized web built-in execution semantics and UI metadata |
| `catalog.ts` | MODIFY | Ensure normalized web built-ins flow through existing catalog/state mechanisms if needed |

### packages/runtime/src/session/ and packages/runtime/src/app-server/

| File | Action | Description |
|------|--------|------------|
| `session/manager.ts` | MODIFY | Preserve normalized web content blocks and avoid local-tool repair assumptions for them |
| `app-server/thread-read-builder.ts` | MODIFY | Rebuild thread reads containing normalized web blocks and citation text |

### packages/web/src/client/lib/

| File | Action | Description |
|------|--------|------------|
| `thread-store.ts` | MODIFY | Preserve and render assistant messages carrying normalized web blocks |
| `thread-utils.ts` | MODIFY | Add helper formatting for new content blocks/citations |
| `tool-reducer.ts` | MODIFY IF NEEDED | Avoid assuming all tool-looking UI comes from `tool_*` events |

### packages/cli/src/tui/components/ and packages/cli/src/tui/

| File | Action | Description |
|------|--------|------------|
| `components/thread-store.ts` | MODIFY | Preserve and render assistant messages carrying normalized web blocks |
| `components/thread-store-utils.ts` | MODIFY | Add helper formatting for new content blocks/citations |
| `render-blocks.ts` | MODIFY IF NEEDED | Reuse/add minimal presentation helpers for citations and web result summaries |

### packages/core/test/

| File | Action | Description |
|------|--------|------------|
| `test/llm/provider/openai-*.test.ts` | CREATE/MODIFY | Verify native web tool request/response mapping |
| `test/llm/provider/chatgpt-*.test.ts` | CREATE/MODIFY | Verify ChatGPT native web tool mapping |
| `test/llm/provider/anthropic-*.test.ts` | CREATE/MODIFY | Verify Anthropic server-tool request/stream parsing |

### packages/runtime/test/ and frontend test directories

| File | Action | Description |
|------|--------|------------|
| Session/thread read tests | CREATE/MODIFY | Verify persistence/replay of normalized web blocks |
| Web/TUI rendering tests | CREATE/MODIFY | Verify minimal display of results and citations |

## Implementation Tasks

### Task 1: Define normalized Diligent request and response contracts for web tools

**Files:** `packages/protocol/src/data-model.ts`, `packages/core/src/llm/types.ts`, `packages/core/src/types.ts`
**Decisions:** D003

Add normalized request-side and response-side contracts for Diligent-native web tools. The protocol must become the canonical response schema, and core LLM types must become the canonical request schema, before provider adapters or frontends can use them.

Recommended additions:

```typescript
export const CitationSchema = z.discriminatedUnion("type", [
  WebSearchCitationSchema,
  DocumentCharCitationSchema,
]);

export const ProviderToolUseBlockSchema = z.object({
  type: z.literal("provider_tool_use"),
  id: z.string(),
  provider: z.enum(["openai", "chatgpt", "anthropic"]),
  name: z.enum(["web_search", "web_fetch"]),
  input: z.record(z.unknown()),
});

export const WebSearchResultBlockSchema = z.object({
  type: z.literal("web_search_result"),
  toolUseId: z.string(),
  provider: z.enum(["openai", "chatgpt", "anthropic"]),
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().optional(),
      pageAge: z.string().optional(),
      encryptedContent: z.string().optional(),
    }),
  ),
  error: z.object({ code: z.string(), message: z.string().optional() }).optional(),
});

export const WebFetchResultBlockSchema = z.object({
  type: z.literal("web_fetch_result"),
  toolUseId: z.string(),
  provider: z.enum(["openai", "chatgpt", "anthropic"]),
  url: z.string(),
  document: z
    .object({
      mimeType: z.string(),
      text: z.string().optional(),
      base64Data: z.string().optional(),
      title: z.string().optional(),
      citationsEnabled: z.boolean().optional(),
    })
    .optional(),
  retrievedAt: z.string().optional(),
  error: z.object({ code: z.string(), message: z.string().optional() }).optional(),
});
```

`TextBlockSchema` should also gain optional `citations`.

In core LLM types, replace the function-only provider tool definition with a discriminated union:

```typescript
export type ToolDefinition = FunctionToolDefinition | ProviderBuiltinToolDefinition;

export interface ProviderBuiltinToolDefinition {
  kind: "provider_builtin";
  capability: "websearch" | "webfetch";
  options?: {
    maxUses?: number;
    allowedDomains?: string[];
    blockedDomains?: string[];
    citationsEnabled?: boolean;
    maxContentTokens?: number;
    userLocation?: {
      type: "approximate";
      city?: string;
      region?: string;
      country?: string;
      timezone?: string;
    };
  };
}
```

The normalized request contract should not expose provider-native names like `web_search_20260209`, `web_fetch_20250910`, `open_page`, or `find_in_page`. Those belong inside provider adapters.

**Verify:** Protocol schemas validate new block types; existing message/tool schemas still pass unchanged tests.

### Task 2: Represent `websearch` and `webfetch` as runtime built-ins with provider-native execution semantics

**Files:** `packages/runtime/src/tools/defaults.ts`, `packages/runtime/src/tools/tool-metadata.ts`, `packages/runtime/src/tools/catalog.ts`, `packages/core/src/agent/assistant.ts`
**Decisions:** D013, D014, D017

Add `websearch` and `webfetch` to the runtime built-in catalog so users can enable, disable, and see them like any other built-in tool. These tools should not run local execution logic in the normal path; instead they should be converted into normalized Diligent web tool definitions during assistant request construction.

Recommended metadata addition:

```typescript
export type ToolExecutionMode = "local" | "provider_builtin";

export interface BuiltinToolMetadata {
  executionMode?: ToolExecutionMode;
  providerCapability?: "websearch" | "webfetch";
}
```

`assistant.ts` should stop assuming every runtime tool becomes a function schema:

```typescript
function toToolDefinition(tool: Tool): ToolDefinition {
  if (tool.name === "websearch") {
    return {
      kind: "provider_builtin",
      capability: "websearch",
    };
  }

  if (tool.name === "webfetch") {
    return {
      kind: "provider_builtin",
      capability: "webfetch",
      options: { citationsEnabled: true },
    };
  }

  return toFunctionToolDefinition(tool);
}
```

This task should also decide where per-tool default options live. This plan assumes defaults belong in runtime metadata or provider mapping helpers, not in a new user-facing config schema in this phase.

**Verify:** Tool catalog lists `websearch` and `webfetch`; existing local tools still serialize as function tools; built-ins can be toggled through the same catalog state.

### Task 3: Map normalized Diligent web tool requests to OpenAI and ChatGPT native payloads

**Files:** `packages/core/src/llm/provider/openai-shared.ts`, `packages/core/src/llm/provider/openai.ts`, `packages/core/src/llm/provider/chatgpt.ts`
**Decisions:** D003

Extend the OpenAI Responses request builder to emit mixed tool arrays. Function tools remain `type: "function"`; normalized Diligent web capabilities are translated into OpenAI-native payloads inside the adapter.

For OpenAI and ChatGPT, this plan intentionally avoids exposing native request semantics outside the adapter. A normalized Diligent request of:

- Diligent `websearch` maps to provider-native `web_search` with action type `search`
- Diligent `webfetch` maps to the same provider-native web-search family with action type `open_page` and, where needed, `find_in_page`

This keeps OpenAI/ChatGPT aligned with codex-rs evidence, where fetch/navigation behavior appears inside `web_search_call` actions rather than a separate `web_fetch_call` type.

Recommended request-side interface:

```typescript
type OpenAIResponsesTool =
  | {
      type: "function";
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      strict?: boolean;
    }
  | {
      type: "web_search" | "web_search_preview";
      filters?: { allowed_domains?: string[] };
      search_context_size?: "low" | "medium" | "high";
      user_location?: {
        type: "approximate";
        city?: string;
        country?: string;
        region?: string;
        timezone?: string;
      };
    };

type OpenAIWebSearchAction =
  | { type: "search"; query?: string; queries?: string[] }
  | { type: "open_page"; url?: string }
  | { type: "find_in_page"; url?: string; pattern?: string };

function mapNormalizedToolToOpenAI(tool: ProviderBuiltinToolDefinition): OpenAIResponsesTool[];
```

When web search is present, automatically include source metadata:

```typescript
body.include = [...new Set([...(body.include ?? []), "web_search_call.action.sources"])]
```

If OpenAI/ChatGPT require additional include fields or a different request-side contract to preserve `open_page` / `find_in_page` outputs, centralize that beside the request helper rather than spreading conditionals across the generic builder.

ChatGPT should reuse the same transformed request body through `buildResponsesRequestBody(...)` so its raw fetch path stays aligned with OpenAI.

**Verify:** Provider tests confirm `/responses` request payloads contain native web-search-family tools alongside function tools; ChatGPT requests mirror the OpenAI tool shape; OpenAI/ChatGPT `webfetch` mapping is covered by action-level request/response tests for `open_page` / `find_in_page`.

### Task 4: Parse OpenAI and ChatGPT native responses into normalized Diligent web result blocks

**Files:** `packages/core/src/llm/provider/openai-shared.ts`, `packages/core/src/agent/assistant.ts`
**Decisions:** D003, D005

Extend the Responses event parser so OpenAI/ChatGPT-native web tool calls are represented as normalized Diligent assistant content blocks instead of being discarded or coerced into local `tool_call` blocks.

The parser should recognize at minimum:

- provider-executed web search call start
- provider-executed web search result payloads / sources
- provider-executed web navigation/fetch-style call start (`open_page`, `find_in_page`)
- provider-executed web navigation/fetch-style result payloads
- text output carrying citations

This task must not require new tool lifecycle events in the first pass if assistant-message reconstruction is sufficient. If the existing event stream can remain unchanged while `message_end` carries the richer assistant content, prefer that narrower change.

Recommended internal state shape:

```typescript
type ResponsesAPIState = {
  contentBlocks: ContentBlock[];
  pendingProviderToolUses: Map<string, ProviderToolUseBlock>;
  pendingWebSearchResults: Map<string, WebSearchResultBlock>;
  pendingWebFetchResults: Map<string, WebFetchResultBlock>;
  currentText: string;
  currentThinking: string;
  usage: Usage;
};
```

The final `AssistantMessage.content` should preserve the order of:

1. text reasoning/decision
2. provider tool use block
3. provider tool result block
4. answer text with citations

Provider-executed web tool calls should **not** create `tool_result` messages, because Diligent did not execute a local tool. Adapter code should collapse provider-native distinctions such as `search`, `open_page`, and `find_in_page` into Diligent-normalized result blocks where appropriate.

**Verify:** Response parsing tests produce assistant messages containing `provider_tool_use`, `web_search_result` and/or `web_fetch_result`, plus citation-bearing text blocks in stable order, with OpenAI/ChatGPT fetch-style behavior sourced from `open_page` / `find_in_page` actions.

### Task 5: Map normalized Diligent web tool requests to Anthropic server-tool payloads

**Files:** `packages/core/src/llm/provider/anthropic.ts`
**Decisions:** D003

Extend Anthropic tool conversion so normalized Diligent web tools are emitted as Anthropic server tools, not `tool_use` function tools.

The implementation should support version selection for both capabilities:

```typescript
function resolveAnthropicWebSearchVersion(input: {
  model: Model;
  codeExecutionEnabled: boolean;
}): "web_search_20250305" | "web_search_20260209";

function resolveAnthropicWebFetchVersion(input: {
  model: Model;
  codeExecutionEnabled: boolean;
}): "web_fetch_20250910" | "web_fetch_20260209";
```

Initial policy:

- prefer `*_20260209` when the selected model supports dynamic filtering and code execution is enabled
- otherwise fall back to the non-dynamic version

Recommended request mapping:

```typescript
type AnthropicServerWebSearchTool = {
  type: "web_search_20250305" | "web_search_20260209";
  name: "web_search";
  max_uses?: number;
  allowed_domains?: string[];
  blocked_domains?: string[];
  user_location?: {
    type: "approximate";
    city?: string;
    region?: string;
    country?: string;
    timezone?: string;
  };
};

type AnthropicServerWebFetchTool = {
  type: "web_fetch_20250910" | "web_fetch_20260209";
  name: "web_fetch";
  max_uses?: number;
  allowed_domains?: string[];
  blocked_domains?: string[];
  citations?: { enabled: boolean };
  max_content_tokens?: number;
};
```

This task should also make the dependency on code execution explicit in the implementation rather than hidden in model-name string checks alone.

**Verify:** Anthropic request tests show correct server-tool payloads and version switching behavior for search/fetch.

### Task 6: Parse Anthropic server-tool stream events into normalized Diligent web result blocks

**Files:** `packages/core/src/llm/provider/anthropic.ts`, `packages/protocol/src/data-model.ts`
**Decisions:** D003, D005

Anthropic returns server-tool web activity as content blocks, not local tool calls. The stream parser must recognize native Anthropic blocks and convert them into normalized Diligent web result blocks:

- `server_tool_use`
- `web_search_tool_result`
- `web_fetch_tool_result`
- citations attached to text blocks

These should be converted into the new protocol-level content blocks without degrading them into plain text. Anthropic-native tool version names should not escape the adapter boundary.

Recommended helper signatures:

```typescript
function convertAnthropicServerToolUse(block: Anthropic.ContentBlock): ProviderToolUseBlock;
function convertAnthropicWebSearchResult(block: Anthropic.ContentBlock): WebSearchResultBlock;
function convertAnthropicWebFetchResult(block: Anthropic.ContentBlock): WebFetchResultBlock;
function convertAnthropicTextWithCitations(block: Anthropic.ContentBlock): TextBlock;
```

The parser must preserve citation continuity fields such as encrypted indexes/content needed for multi-turn citation references.

**Verify:** Anthropic streaming tests produce assistant messages containing server-tool use blocks, result blocks, and citation-bearing text from representative response payloads including error cases.

### Task 7: Preserve normalized web blocks through session persistence and thread reads

**Files:** `packages/runtime/src/session/manager.ts`, `packages/runtime/src/app-server/thread-read-builder.ts`, any adjacent session entry types/tests
**Decisions:** D036, D041

Update runtime persistence/replay code so the new normalized assistant web content blocks survive:

- append-only session storage
- thread resume
- thread read reconstruction
- interrupted session repair logic

Important constraint: normalized web blocks must not be mistaken for orphaned local `tool_call` blocks that require synthetic `tool_result` repair.

Recommended guard:

```typescript
function isLocalExecutableToolCall(block: ContentBlock): block is ToolCallBlock {
  return block.type === "tool_call";
}
```

Thread read builders should surface the new blocks as ordinary assistant content so both Web and TUI can render them without private session-only conventions.

**Verify:** Session tests confirm round-tripping of assistant messages containing provider-native web blocks; resume does not inject fake `tool_result` entries for provider-native activity.

### Task 8: Add minimal Web and TUI rendering for normalized web blocks and citations

**Files:** `packages/web/src/client/lib/thread-store.ts`, `packages/web/src/client/lib/thread-utils.ts`, `packages/web/src/client/lib/tool-reducer.ts` (if needed), `packages/cli/src/tui/components/thread-store.ts`, `packages/cli/src/tui/components/thread-store-utils.ts`, `packages/cli/src/tui/render-blocks.ts` (if needed)
**Decisions:** D004, D005

Implement minimal, safe rendering only. The UI scope for this plan is intentionally limited to "do not break and make the result understandable." It does not attempt a polished citation browser.

Minimum rendering requirements:

- `provider_tool_use`
  - show provider + tool name + compact input summary
- `web_search_result`
  - show result count and source URLs/titles
- `web_fetch_result`
  - show fetched URL, title, and content type
- citations on text blocks
  - render as inline markers or attached footnotes/metadata rows

Recommended fallback renderer shape:

```typescript
function renderProviderToolUse(block: ProviderToolUseBlock): string;
function renderWebSearchResult(block: WebSearchResultBlock): string;
function renderWebFetchResult(block: WebFetchResultBlock): string;
function renderTextCitations(block: TextBlock): string[];
```

The TUI and Web may differ visually, but both must preserve the same information and degrade gracefully when citation payloads are large. Prefer adapting existing assistant-message rendering paths over inventing a separate provider-tool timeline UI in this phase.

**Verify:** Frontend tests and manual inspection show new blocks render without crashes; text with citations remains readable in both clients.

### Task 9: Add focused tests for normalized request mapping, parsing, and replay

**Files:** provider tests under `packages/core/test/`, runtime replay tests, frontend rendering tests
**Decisions:** D003

Add tests at the narrowest level first:

1. request-building tests for normalized-to-provider mapping in OpenAI, ChatGPT, and Anthropic
2. stream parsing tests for provider-to-normalized web result blocks
3. protocol schema tests for new block types and citations
4. runtime session replay tests
5. minimal rendering tests for Web and TUI

Suggested test cases:

- OpenAI request with function tools + Diligent `websearch` + Diligent `webfetch`
- ChatGPT request parity with OpenAI request body
- Anthropic request with search/fetch version selection
- Anthropic streaming of `server_tool_use` + `web_search_tool_result`
- Anthropic streaming of `server_tool_use` + `web_fetch_tool_result`
- OpenAI/ChatGPT parsing of `web_search_call` actions for `search`, `open_page`, and `find_in_page`
- text blocks carrying citations
- session repair path with provider-native blocks present

**Verify:** Targeted tests pass; no regression in existing local tool/function-tool flows.

## Acceptance Criteria

1. Diligent exposes `websearch` and `webfetch` as built-in tools in the shared runtime tool catalog.
2. OpenAI and ChatGPT provider requests are derived from normalized Diligent `websearch` / `webfetch` definitions rather than provider-native request structures leaking into runtime layers.
3. Anthropic provider requests are derived from the same normalized Diligent `websearch` / `webfetch` definitions, with deterministic version selection inside the adapter.
4. Provider-executed web tool activity is persisted as normalized assistant content blocks, not synthetic local `tool_result` messages.
5. Citation and source metadata from provider-native web tool responses survive normalization, protocol validation, session persistence, and thread reads.
6. Web and TUI both render the new blocks and citation-bearing text without runtime errors, using existing assistant-message surfaces rather than a separate bespoke timeline UI.
7. Existing local tool execution and function-tool provider behavior remains intact for non-web tools, while provider differences for web tools remain isolated inside adapter code.
8. New code stays within strict TypeScript expectations without `any` escape hatches in the added logic.

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | Protocol schemas for provider-native blocks and citations | `bun test` for `packages/protocol` schema cases |
| Unit | `assistant.ts` tool-definition conversion for `websearch` / `webfetch` | `bun test` with normalized tool-definition assertions |
| Unit | OpenAI/ChatGPT request builders | Mock `/responses` payload capture tests for normalized-to-native `search`, `open_page`, and `find_in_page` mappings |
| Unit | Anthropic server-tool request builders | Mock SDK request assertions |
| Unit | Provider stream parsers | Feed representative provider events and assert resulting normalized assistant content blocks |
| Integration | Session persistence and thread read replay | Runtime tests that append/read assistant messages with new blocks |
| Integration | Web/TUI minimal rendering | Client tests for representative provider-native blocks and citations |
| Manual | Real-provider smoke test | Run one OpenAI/ChatGPT session and one Anthropic session using `websearch` and `webfetch` |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Normalized request model is too abstract and misses provider-specific capabilities | Provider adapters become brittle or lossy | Keep the normalized schema intentionally narrow and focused on the current built-ins only (`websearch`, `webfetch`) |
| OpenAI/ChatGPT fetch-style behavior differs from codex-rs assumptions | Native requests or parsing fail at runtime | Keep fetch-style mapping isolated behind adapter helpers and verify against request/response capture tests before rollout |
| Anthropic server-tool result/citation parsing is incomplete | Citation continuity or transcript fidelity breaks | Promote citations and result blocks into protocol types first, then add provider parser tests with representative payloads |
| Existing assistant content assumptions are function-tool-only | Replay/UI regressions in unrelated flows | Keep normalized web blocks additive and do not change existing local tool result semantics |
| Session repair logic injects fake local tool results for provider-native blocks | Corrupted transcript history | Explicitly scope repair logic to local `tool_call` blocks only |
| Large fetch payloads bloat transcripts and compaction cost | Slower sessions or oversized stored messages | Preserve full fidelity in MVP but isolate payload handling behind explicit block types so future truncation/projection can be added without schema churn |
| Web/TUI rendering diverges | Thin-client contract weakens | Keep rendering driven from shared protocol blocks and limit this phase to minimal informational rendering |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D003 | Provider abstraction from day one | Provider-native tool union, provider adapters, parsing tasks |
| D005 | Unified messages (not part-based) | Assistant content block expansion and transcript persistence |
| D013 | Tool definition interface with execute function | Runtime built-in representation and assistant conversion |
| D014 | Tool registry as simple map/builder | Built-in catalog integration for `websearch` / `webfetch` |
| D017 | Initial tool set is extensible | Adding new built-in tools |
| D036 | Session persistence is append-only JSONL | Persistence/replay requirements |
| D041 | Re-inject context after compaction | Transcript fidelity and future compaction compatibility |
