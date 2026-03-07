---
id: P040
status: proposed
created: 2026-03-07
---

# P040: Structured Tool Result Render Blocks

## Summary

Introduce a shared, protocol-level structured render format for tool results so custom tools can express UI intent without shipping frontend code.

The feature should allow a tool to return:

1. a required plain-text fallback for model/context and non-rich clients
2. an optional structured render payload for richer presentation
3. a single cross-client contract used by both Web and TUI

This plan intentionally avoids plugin-defined React components or frontend code execution. Tools describe data and presentation intent; Diligent frontends render that intent with built-in components.

## Motivation

Custom tools increasingly need to present results better than plain text:

- tables
- labeled key/value sections
- hierarchical trees
- badges or status rows
- summary cards
- lists with richer semantics than markdown alone

Today, tools can only reliably return `output: string` plus ad hoc `metadata`. That keeps core simple, but it leaves frontend rendering inconsistent and non-contractual.

A middle path is needed:

- richer than plain text
- safer than frontend plugin code
- shared across Web and TUI
- explicit in the protocol rather than hidden in tool-specific metadata conventions

## Problem Statement

Current behavior has three important limitations:

1. `ToolResult` in core exposes `output` plus optional free-form `metadata`, but render meaning is not standardized.
2. protocol `ToolResultMessageSchema` only carries `output`, so rich tool-result UI intent is not part of the shared frontend contract.
3. Web and TUI therefore cannot implement first-class, reusable structured renderers without inventing out-of-band conventions.

If we do nothing, plugin authors will push toward frontend-specific hacks such as:

- encoding JSON blobs inside `output`
- overloading `metadata` with client-private shapes
- requesting direct React component/plugin rendering in Web only

That would violate Diligent's thin-client architecture and create long-term protocol drift.

## Goals

1. Add a protocol-level structured render payload for tool results.
2. Preserve `output` as the required fallback text for LLM context, persistence, and non-rich rendering.
3. Support both built-in tools and custom plugin tools.
4. Render the same structured payload in Web and TUI with client-appropriate presentation.
5. Keep the contract declarative and data-oriented.
6. Keep the initial block vocabulary intentionally small.
7. Preserve current behavior for tools that only return plain text.

## Non-Goals

1. No plugin-defined React, JSX, CSS, or arbitrary frontend code execution.
2. No client-specific result contracts such as "Web-only render payloads".
3. No replacement of plain-text `output` as the canonical LLM-facing tool result.
4. No attempt to make every possible visualization type part of MVP.
5. No live interactive widgets in this phase.
6. No streaming partial structured blocks in this phase beyond existing plain-text updates.

## Architectural Position

This feature should follow the existing product philosophy:

- core owns the contract
- protocol is shared
- Web and TUI are thin renderers over the same payload
- plain text remains the universal fallback

The structured payload should be a first-class, typed result channel rather than an undocumented `metadata` convention.

## User Experience Principles

1. Every tool result still has readable plain text.
2. Rich rendering is additive, not required.
3. Web may render more visually, but TUI must still present the same information clearly.
4. Unknown render blocks should degrade gracefully to plain text rather than break the UI.
5. Rich rendering should never hide the raw fallback text from debugging flows.

## Proposed Data Model

## Tool result shape in core

Extend core tool results so tools can optionally return a structured render payload.

Current shape:

```ts
interface ToolResult {
  output: string;
  metadata?: Record<string, unknown>;
  truncateDirection?: "head" | "tail" | "head_tail";
  abortRequested?: boolean;
}
```

Proposed direction:

```ts
interface ToolResult {
  output: string;
  render?: ToolRenderPayload;
  metadata?: Record<string, unknown>;
  truncateDirection?: "head" | "tail" | "head_tail";
  abortRequested?: boolean;
}
```

`render` should be the typed, shared contract.

`metadata` remains available for non-render concerns and backwards compatibility, but frontend rendering should not depend on arbitrary metadata once `render` exists.

## Protocol message shape

Extend protocol tool-result messages to include the optional structured payload.

Current protocol shape only carries:

- `toolCallId`
- `toolName`
- `output`
- `isError`
- `timestamp`

Proposed addition:

- `render?: ToolRenderPayload`

This ensures persisted messages, RPC responses, Web UI state, debug tooling, and future replay flows all see the same structured result data.

## Initial render block vocabulary

Keep MVP block types deliberately small and broadly useful.

Recommended initial block kinds:

1. `summary`
   - short emphasized text summary
2. `key_value`
   - labeled fields
3. `list`
   - ordered or unordered items
4. `table`
   - columns and rows
5. `tree`
   - hierarchical file/resource style display
6. `status_badges`
   - compact labeled statuses/tags

Suggested top-level shape:

```ts
type ToolRenderPayload = {
  version: 1;
  blocks: ToolRenderBlock[];
};

type ToolRenderBlock =
  | SummaryBlock
  | KeyValueBlock
  | ListBlock
  | TableBlock
  | TreeBlock
  | StatusBadgesBlock;
```

Each block should be purely declarative JSON data.

## Fallback rules

The following rules should be invariant:

1. `output` is always required.
2. `render` is optional.
3. If a client does not support structured rendering, it still uses `output`.
4. If a specific block kind is unknown, the client ignores that block and still shows `output`.
5. If protocol validation fails for `render`, the tool result must still be representable as plain text wherever possible.

## Key Design Decisions

### 1. `output` remains canonical for LLM context

The model should continue to receive plain-text tool results.

Reason:

- existing agent loop behavior stays stable
- compaction/session persistence stays understandable
- model providers do not need structured tool-result semantics
- debugging remains transparent

Structured render payloads are for client rendering, not model reasoning.

### 2. Structured render payload is explicit, not hidden in `metadata`

Reason:

- protocol types remain authoritative
- frontend behavior is predictable
- plugin authors get a documented contract
- test coverage becomes straightforward

### 3. Web and TUI share the same block vocabulary

Reason:

- avoids Web-only drift
- preserves thin-client architecture
- keeps plugin authoring simple
- reduces future migration cost

### 4. Unknown blocks must fail soft

Reason:

- clients may lag behind protocol versions
- plugins may produce blocks introduced in newer versions
- degradation to `output` prevents UI breakage

## Current Relevant Surfaces

### Core

- `packages/core/src/tool/types.ts`
  - `ToolResult`
- agent execution and persistence paths that carry tool results
- any session/message persistence types used for tool results

### Protocol

- `packages/protocol/src/data-model.ts`
  - `ToolResultMessageSchema`
- any related client/server schemas or event payloads

### Web

- thread store / event reducer path that stores tool results
- tool result rendering components in the client UI
- tests around thread rendering and rpc client behavior

### TUI

- chat/tool result rendering path
- markdown/text rendering layer
- tests for terminal output formatting where relevant

### Debug / Replay tooling

- debug-viewer data-model mirroring of tool results
- any session replay logic that assumes tool results are text-only

## Risks

### 1. Protocol churn risk

If the block vocabulary is too vague, we will need breaking changes quickly.

Mitigation:

- keep MVP small
- include explicit `version`
- prefer generic, reusable blocks over domain-specific ones

### 2. Web/TUI parity drift

Web will naturally want richer presentation sooner.

Mitigation:

- require every block to have a TUI rendering strategy before adding it
- define graceful TUI output expectations in the plan

### 3. Persistence/replay mismatch

If stored session entries do not carry structured payloads, replayed UI will differ from live UI.

Mitigation:

- extend persisted tool result message shape, not only transient runtime objects

### 4. Plugin abuse / over-complex payloads

Plugins may attempt to dump giant tables or deeply nested trees.

Mitigation:

- document payload size expectations
- keep normal output truncation rules in mind
- consider later guardrails for row/item counts if needed

### 5. Streaming complexity

Current tool streaming is text-oriented.

Mitigation:

- MVP uses structured payloads only for final tool results
- keep partial streaming textual for now

## Rollout Strategy

Implement in four layers, in order.

## Task 1 — Define shared render payload types in protocol

### Scope

Add typed schemas and exports for structured tool-result render payloads.

### Changes

- add render block schemas to `packages/protocol`
- extend `ToolResultMessageSchema` with optional `render`
- export inferred TS types
- add protocol validation tests for valid and invalid payloads

### Acceptance criteria

- protocol validates supported render block payloads
- invalid blocks are rejected at schema level
- existing plain-text-only tool results remain valid

## Task 2 — Extend core tool result and persistence pipeline

### Scope

Allow tools to return structured render payloads and preserve them through the tool-result lifecycle.

### Changes

- extend core `ToolResult`
- map `ToolResult.render` into persisted/session/protocol tool-result messages
- ensure runtime event emission carries the new field where needed
- verify existing callers remain source-compatible when `render` is omitted

### Acceptance criteria

- a tool can return `{ output, render }`
- persisted tool-result messages retain `render`
- plain-text-only tools continue working unchanged

## Task 3 — Web renderer for structured tool results

### Scope

Teach Web UI to render structured result blocks while keeping raw/fallback visibility.

### Changes

- extend thread-store/client message types to retain `render`
- add block renderer components for each MVP block kind
- update tool result UI component(s) to prefer structured rendering when present
- preserve visible fallback text for debugging, copy, or collapsed/raw view as appropriate
- add component/store tests for representative block payloads

### Acceptance criteria

- Web renders each MVP block kind correctly
- unknown blocks do not crash rendering
- plain-text-only tool results still render exactly as before

## Task 4 — TUI renderer for structured tool results

### Scope

Render the same payload in terminal-friendly form.

### Changes

- extend TUI tool-result data path to carry `render`
- add text renderers for each MVP block kind
- define readable formatting for tables, lists, trees, and key/value sections
- fall back cleanly to `output` when rendering is unsupported or too wide
- add TUI-focused tests for representative outputs

### Acceptance criteria

- TUI can render each MVP block kind without breaking layout
- output remains readable in narrow terminals
- plain-text-only behavior remains unchanged

## Task 5 — Example tool and docs

### Scope

Demonstrate the contract for plugin authors and built-in tool evolution.

### Changes

- update `examples/external-tool-plugin/` to optionally emit a structured payload
- document plugin author contract in `docs/tool-settings.md` or a dedicated doc section
- explain fallback semantics and supported block kinds

### Acceptance criteria

- plugin authors have one concrete example returning structured blocks
- docs clearly state that frontend code injection is not supported
- docs explain that `output` is still required

## Task 6 — End-to-end verification

### Scope

Verify full-stack behavior across protocol, Web, and TUI.

### Changes

- add e2e coverage or a focused integration suite that exercises one tool returning structured payloads
- verify that the same result appears in Web and TUI, with client-appropriate formatting
- verify persistence/reload behavior if session replay already covers tool results

### Acceptance criteria

- at least one cross-layer test covers `{ output, render }`
- replay/resubscribe flows do not lose structured payloads

## Suggested MVP Block Schemas

This section is intentionally concrete enough to guide implementation without locking every field forever.

### Summary block

```ts
type SummaryBlock = {
  type: "summary";
  text: string;
  tone?: "default" | "success" | "warning" | "danger" | "info";
};
```

### Key/value block

```ts
type KeyValueBlock = {
  type: "key_value";
  title?: string;
  items: Array<{
    key: string;
    value: string;
  }>;
};
```

### List block

```ts
type ListBlock = {
  type: "list";
  title?: string;
  ordered?: boolean;
  items: string[];
};
```

### Table block

```ts
type TableBlock = {
  type: "table";
  title?: string;
  columns: string[];
  rows: string[][];
};
```

### Tree block

```ts
type TreeBlock = {
  type: "tree";
  title?: string;
  nodes: TreeNode[];
};

type TreeNode = {
  label: string;
  children?: TreeNode[];
};
```

### Status badges block

```ts
type StatusBadgesBlock = {
  type: "status_badges";
  title?: string;
  items: Array<{
    label: string;
    tone?: "default" | "success" | "warning" | "danger" | "info";
  }>;
};
```

## Open Questions

These do not block the plan but should be decided during implementation.

1. Should fallback text always be visibly rendered in Web/TUI, or only available via a raw/details view?
2. Should block payloads be capped by schema or only by runtime guards?
3. Should the first MVP include markdown-in-block-fields, or should all block text be plain strings?
4. Should tool streaming later support incremental block assembly, or remain final-result-only?
5. Should debug-viewer get first-class block rendering in the same phase or just preserve payloads initially?

## Recommended Answers for MVP

1. Keep fallback text persisted and inspectable, but do not require duplicating it prominently when a rich renderer exists.
2. Start with schema validation plus light runtime sanity checks if needed.
3. Use plain strings first; markdown-in-blocks can be a follow-up.
4. Keep structured blocks final-result-only in MVP.
5. Preserve payloads first; rich debug-viewer rendering can be a follow-up unless implementation cost is trivial.

## Implementation Order Recommendation

Recommended execution sequence:

1. protocol schemas and tests
2. core `ToolResult` and persistence plumbing
3. Web renderer
4. TUI renderer
5. example plugin update and docs
6. end-to-end coverage

This order minimizes churn because the client implementations depend on the protocol/core shape being settled first.

## Success Criteria

The feature is complete when:

- tools can optionally return a shared structured render payload
- protocol and persistence preserve that payload
- Web renders the payload with built-in components
- TUI renders the same payload in readable text form
- tools without structured payloads behave exactly as before
- plugin authors have a documented, frontend-safe extension point for richer result presentation

## Out of Scope Follow-Ups

Potential future work after P040:

- expandable/collapsible block state persistence
- richer numeric/metric block types
- charts/plots if a safe, shared abstraction emerges
- streaming structured result assembly
- debug-viewer rich block renderers
- copy/export actions per block kind
