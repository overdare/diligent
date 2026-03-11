---
id: P045
status: proposed
created: 2026-03-11
---

# P045: Static Tool Renderer Metadata via Tools List

## Summary

Replace per-result `ToolRenderPayload` delivery with static, per-tool renderer metadata declared at tool load time and delivered through `TOOLS_LIST`.

Under this plan:

1. tools no longer attach rich render payloads to individual `ToolResult`s
2. each tool declares a static renderer config as part of its definition/descriptor
3. Web receives renderer metadata from `ToolsListResponse.tools`
4. Web renders tool calls by combining:
   - the tool's static renderer config
   - the tool call input
   - the tool call output
5. plain input/output fallback remains available for unknown or unsupported renderer configs

This is a deliberate architectural reversal of P040's dynamic result-embedded render payload model.

## Background

The current implementation sends optional `ToolRenderPayload` objects inside tool results and persists them through tool-result messages.

That approach proved rich tool rendering was possible, but it conflicts with the now-chosen product direction:

- render behavior should be known when tools are loaded, not decided ad hoc per execution
- frontends should learn render intent from tool metadata, not from each result packet
- Web should not depend on a live `tool_end.render` field to know how a tool is supposed to display
- tool rendering should behave more like a static view contract than a second result channel

The immediate symptom that exposed this mismatch was that plugin tools such as `studiorpc_level_browse` generated render payloads, but Web fell back to plain `Input/Output` when the live event path failed to forward the payload.

Rather than patching that path, the chosen direction is to stop shipping rich render payloads inside results entirely.

## Decision Summary

This plan assumes the following decisions:

1. **Do not send `ToolRenderPayload` inside tool results anymore**
2. **Tool render must be decided when the tool is loaded**
3. **Web receives tool render metadata through `TOOLS_LIST` only**
4. **Use structured static renderer config, not a simple renderer key**
5. **Migrate all tools, not only OVERDARE plugins**

## Goals

1. Remove dynamic structured render payload delivery from tool execution results.
2. Introduce a protocol-backed static renderer config on each tool descriptor.
3. Deliver renderer configs to Web via `ToolsListResponse.tools`.
4. Let Web render tool calls deterministically from descriptor metadata plus raw input/output.
5. Preserve plain text `output` as the canonical model-facing tool result.
6. Preserve a graceful fallback when a renderer config is missing, invalid, or unsupported.
7. Keep the implementation shared across built-ins and plugins.

## Non-Goals

1. No plugin-defined React components or frontend code execution.
2. No transport of arbitrary UI trees from tools at execution time.
3. No move of renderer metadata into `initialize` for this phase.
4. No TUI migration in this first implementation unless explicitly chosen later.
5. No attempt to infer renderer config automatically from previous dynamic payloads at runtime.

## Problem Statement

Current architecture has three competing sources of truth:

1. the tool name
2. the tool result output text
3. an optional dynamic `render` payload attached to the result

That creates several problems:

- render behavior is not statically knowable from the tool catalog
- live and hydrated paths can diverge depending on whether `render` survived transport
- clients cannot prepare renderer behavior from tool metadata alone
- tool UI becomes coupled to execution-time result shaping rather than stable tool identity
- persistence and replay semantics are more complex than necessary

The new direction is to treat renderer configuration as tool metadata, not as a second execution result.

## Proposed Model

### 1. Tool definition grows a static renderer config

Core tools and plugin tools should declare renderer metadata directly on the tool definition.

```ts
type ToolRendererConfig = {
  kind: string;
  version: 1;
  config?: Record<string, unknown>;
};

interface Tool<TParams extends z.ZodType = any> {
  name: string;
  description: string;
  parameters: TParams;
  execute: (args: z.infer<TParams>, ctx: ToolContext) => Promise<ToolResult>;
  supportParallel?: boolean;
  renderer?: ToolRendererConfig;
}
```

Notes:

- `renderer` is static metadata attached to the tool definition
- it is available immediately when tools are loaded into the catalog
- it does not vary per call

### 2. Tool results lose structured render payloads

```ts
interface ToolResult {
  output: string;
  metadata?: Record<string, unknown>;
  truncateDirection?: "head" | "tail" | "head_tail";
  abortRequested?: boolean;
}
```

`ToolRenderPayload` should no longer be part of normal tool execution flow.

### 3. Protocol tool descriptors carry renderer config

`ToolDescriptorSchema` should grow a typed renderer field and `ToolsListResponse.tools` becomes the delivery mechanism.

```ts
const ToolRendererConfigSchema = z.object({
  kind: z.string(),
  version: z.literal(1),
  config: z.record(z.string(), z.unknown()).optional(),
});

const ToolDescriptorSchema = z.object({
  name: z.string(),
  source: z.enum(["builtin", "plugin"]),
  pluginPackage: z.string().optional(),
  enabled: z.boolean(),
  immutable: z.boolean(),
  configurable: z.boolean(),
  available: z.boolean(),
  reason: ToolStateReasonSchema,
  error: z.string().optional(),
  renderer: ToolRendererConfigSchema.optional(),
});
```

### 4. Web renders from descriptor metadata

Web should stop expecting `item.render` to arrive from `tool_end` or session history for new behavior.

Instead, Web rendering should use:

- `toolName`
- descriptor renderer config from `ToolsListResponse`
- raw `inputText`
- raw `outputText`
- `isError`

Conceptually:

```ts
renderToolCall({
  descriptorRenderer,
  inputText,
  outputText,
  isError,
})
```

The result of that function may still be a local client-side block tree, but it is derived on the client from static metadata rather than shipped by the tool.

## Renderer Config Design

The selected direction is **renderer config**, not just a renderer key.

That means the schema should support static, declarative instructions such as:

- which renderer kind to use
- how to extract data from input or output
- what titles or labels to show
- whether output should be treated as tree, list, table, text, file, command, or diff
- optional static adornments such as section titles or field labels

### Recommended first-pass shape

```ts
type ToolRendererConfig = {
  kind:
    | "command"
    | "file"
    | "diff"
    | "list"
    | "tree"
    | "key_value"
    | "summary"
    | "table"
    | "raw";
  version: 1;
  config?: {
    title?: string;
    source?: "input" | "output" | "input_json" | "output_json";
    inputPath?: string;
    outputPath?: string;
    columns?: string[];
    ordered?: boolean;
    fields?: string[];
    [key: string]: unknown;
  };
}
```

This is intentionally generic for the plan stage. The implementation can tighten it into a discriminated union once the first real migrations are underway.

## Example Mappings

### `studiorpc_level_browse`

```json
{
  "renderer": {
    "kind": "tree",
    "version": 1,
    "config": {
      "title": "Level tree",
      "source": "output_json",
      "outputPath": "level"
    }
  }
}
```

Meaning:

- parse output as JSON
- read `level`
- transform nodes into the tree presentation

### `studiorpc_script_add`

```json
{
  "renderer": {
    "kind": "key_value",
    "version": 1,
    "config": {
      "title": "Studio script add",
      "source": "input_json",
      "fields": ["class", "name", "parentGuid"],
      "appendSummaryFromOutput": true
    }
  }
}
```

### `bash`

```json
{
  "renderer": {
    "kind": "command",
    "version": 1,
    "config": {
      "source": "input_json",
      "inputPath": "command"
    }
  }
}
```

### `read`

```json
{
  "renderer": {
    "kind": "file",
    "version": 1,
    "config": {
      "source": "input_json",
      "filePathPath": "file_path",
      "offsetPath": "offset",
      "limitPath": "limit",
      "contentSource": "output_text"
    }
  }
}
```

## Data Flow After Migration

### Tool load time

1. built-ins are created with static `renderer` config
2. plugins are loaded with static `renderer` config on each tool
3. tool catalog stores `renderer` in `ToolStateEntry`
4. `TOOLS_LIST` returns descriptor metadata including `renderer`

### Tool execution time

1. tool executes
2. tool returns plain `output` plus optional non-render `metadata`
3. agent loop persists plain tool result message without render payload
4. live tool events carry input, output, and error only
5. Web uses cached tool descriptor renderer config to render the tool call

## Affected Surfaces

### Protocol

- `packages/protocol/src/client-requests.ts`
  - add `ToolRendererConfigSchema`
  - add `renderer?: ToolRendererConfig` to `ToolDescriptorSchema`
- `packages/protocol/src/data-model.ts`
  - remove `render` from `ToolResultMessageSchema`
  - optionally keep temporary legacy parsing for old sessions during migration

### Core

- `packages/core/src/tool/types.ts`
  - add static `renderer?: ToolRendererConfig` to `Tool`
  - remove `render` from `ToolResult`
- `packages/core/src/tool/executor.ts`
  - remove result-side `ToolRenderPayloadSchema` validation
- `packages/core/src/tools/catalog.ts`
  - extend `ToolStateEntry` to include `renderer`
  - populate it from loaded tools for both built-ins and plugins
- `packages/core/src/app-server/thread-handlers.ts`
  - `handleToolsList()` and `handleToolsSet()` should return descriptors including renderer metadata
- `packages/core/src/agent/loop.ts`
  - stop copying `result.render` into `ToolResultMessage`
- `packages/core/src/agent/types.ts`
  - ensure tool events do not carry render payloads

### Plugins and built-ins

Each tool creator should declare a static renderer config.

This affects:

- built-in tools in `packages/core/src/tools/*`
- OVERDARE plugins in `thirdparty/overdare/plugins/*`
- external plugin examples and plugin docs

### Web

- `packages/web/src/client/App.tsx`
  - fetch and cache latest `ToolsListResponse`
  - keep a shared map of `toolName -> ToolDescriptor`
- `packages/web/src/client/components/ToolSettingsModal.tsx`
  - continue consuming `ToolsListResponse`; optionally notify parent with latest descriptors
- `packages/web/src/client/lib/thread-store.ts`
  - remove reliance on `item.render` for future behavior
- `packages/web/src/client/lib/thread-hydration.ts`
  - stop expecting `message.render` for new sessions
  - optionally keep temporary legacy support for old sessions
- `packages/web/src/client/components/ToolBlock.tsx`
  - render using descriptor renderer config looked up by tool name
  - keep plain Input/Output fallback when renderer metadata is missing or unsupported
- `packages/web/src/client/lib/tool-info.ts`
  - replace or heavily reduce `deriveRenderPayload()`
  - introduce descriptor-driven render building

## Migration Strategy

### Phase 1: Add metadata path without removing old render yet

1. add `renderer` to tool definitions and tool descriptors
2. expose it via `TOOLS_LIST`
3. cache descriptors in Web
4. add a new Web path that can render from descriptor metadata
5. prefer descriptor metadata over dynamic `item.render`

This phase proves the new architecture before deleting old fields.

### Phase 2: Migrate built-ins and plugins

1. add static renderer config to built-ins
2. add static renderer config to OVERDARE plugins
3. convert Web renderers for the migrated tools
4. verify old dynamic payload is no longer needed for those tools

### Phase 3: Remove old dynamic payload path

1. remove `render` from `ToolResult`
2. remove `render` from `ToolResultMessageSchema`
3. remove render validation in executor
4. remove result render builders from tools and plugins
5. delete `tool_end.render` handling where still present

## Compatibility Considerations

### Existing session history

Old persisted sessions may still contain `message.render`.

Recommended handling:

- Web may continue to honor historical `message.render` during a short transition period
- new executions should rely on descriptor metadata only
- after the transition, history hydration can either ignore `message.render` or support it only as legacy input

### Unknown renderer configs

If the client does not recognize a renderer config:

- show plain Input/Output fallback
- do not break the tool row
- optionally show a subtle debug hint in development only

### Thread-specific tool catalogs

Because `TOOLS_LIST` is thread-aware today, renderer metadata should remain thread-scoped as well.

This is another reason `TOOLS_LIST` is a better delivery mechanism than `initialize`.

## Risks

1. **Renderer config may become too generic and hard to validate**
   - Mitigation: start with a small union of explicit renderer kinds and config schemas
2. **Web may need tool-specific transformation logic anyway**
   - Mitigation: keep transformation logic organized by renderer kind, not by arbitrary tool name where possible
3. **Historical sessions may render differently from new sessions**
   - Mitigation: preserve temporary legacy hydration support during migration
4. **Plugin authoring complexity may shift from result code to metadata design**
   - Mitigation: document standard renderer recipes and provide examples
5. **TUI may lag behind Web**
   - Mitigation: explicitly scope first implementation to Web if needed, while keeping protocol shape shared

## Open Questions

1. Should `ToolRendererConfig` be a loose `{ kind, config }` object first, or a discriminated union from day one?
   - Recommendation: use a discriminated union for known renderer kinds as soon as practical
2. Should the client-side renderer builder parse JSON paths generically, or should some renderers stay tool-specific?
   - Recommendation: generic where straightforward, tool-specific helpers only when the source data shape is unusually irregular
3. Should TUI adopt the same static renderer metadata in the same phase?
   - Recommendation: not required for the first implementation, but do not block it architecturally
4. Should `initialize` ever include a renderer registry version or hash?
   - Recommendation: no for now; `TOOLS_LIST` is sufficient and thread-aware

## Concrete Implementation Checklist

### Protocol

- add `ToolRendererConfigSchema`
- extend `ToolDescriptorSchema`
- deprecate and remove `ToolResultMessage.render`
- update protocol tests

### Core

- add `renderer` to `Tool`
- remove `render` from `ToolResult`
- propagate renderer into `ToolStateEntry`
- return renderer in `handleToolsList()` and `handleToolsSet()`
- remove render validation in executor
- remove render handling in loop and event types

### Built-in tools

- declare renderer config for all built-ins that currently use hardcoded Web derivation
- prefer config-driven shapes over tool-name switches

### Plugins

- declare renderer config for OVERDARE plugins
- update example external plugin docs to show static renderer config declaration
- remove dynamic render builders after migration completes

### Web

- cache `ToolsListResponse.tools`
- expose descriptor lookup to tool row rendering
- build render blocks from static renderer config plus raw data
- keep raw fallback path
- add tests for descriptor-driven rendering

## Acceptance Criteria

1. `TOOLS_LIST` returns renderer metadata for tools.
2. Web can render `studiorpc_level_browse` as a tree using descriptor metadata without any per-result render payload.
3. Web can render representative built-ins such as `bash`, `read`, and `apply_patch` from descriptor metadata.
4. A tool result packet no longer needs a `render` field for rich Web rendering.
5. Unknown or missing renderer config falls back cleanly to plain `Input/Output`.
6. Old sessions do not crash during hydration.

## Recommended First Implementation Slice

To reduce risk, the first implementation slice should be:

1. protocol support for `ToolDescriptor.renderer`
2. core tool metadata plumbing into `TOOLS_LIST`
3. Web cache of `ToolsListResponse.tools`
4. descriptor-driven rendering for:
   - `studiorpc_level_browse`
   - `bash`
   - `read`
   - `apply_patch`
5. only after that, remove dynamic render from result messages

This sequence keeps the migration observable and reversible.
