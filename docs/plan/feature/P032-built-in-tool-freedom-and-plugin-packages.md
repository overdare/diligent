---
id: P032
status: done
created: 2026-03-05
---

# P032: Built-in Tool Freedom + JavaScript Package Tool Plugins

## Summary

Allow users to:

1. Disable selected built-in tools.
2. Add trusted JavaScript package tools through config.
3. Enable or disable packages and individual plugin tools.
4. Manage all of the above through shared protocol-backed settings in both Web and TUI.

Core groundwork for P032 already exists in `packages/core`, but the feature is not complete from a product perspective. This plan updates the document from a high-level idea into a detailed, execution-ready rollout.

## Current Checkpoint in Repo

The following pieces already exist:

- `packages/core/src/config/schema.ts`
  - `tools.builtin`
  - `tools.plugins`
  - `tools.conflictPolicy`
- `packages/core/src/tools/defaults.ts`
  - built-in tool assembly already passes through `buildToolCatalog()`
- `packages/core/src/tools/catalog.ts`
  - built-in toggle handling
  - plugin loading
  - immutable-tool enforcement
  - conflict policy application
- `packages/core/src/tools/plugin-loader.ts`
  - dynamic package import
  - manifest validation
  - `createTools()` validation
  - basic tool-shape validation
- `packages/core/src/tools/immutable.ts`
  - immutable set currently includes `plan` and `request_user_input`
- existing core tests:
  - `packages/core/src/tools/__tests__/catalog.test.ts`
  - `packages/core/src/tools/__tests__/plugin-loader.test.ts`

What is still missing or incomplete:

- richer state metadata for UI
- config persistence/update flow for tools
- shared protocol methods for listing/updating tool settings
- app-server handlers for the new methods
- next-turn refresh semantics after config changes
- Web settings UI
- TUI settings UI
- end-to-end coverage
- docs/example package guidance for plugin authors

## Context

Historically, Diligent treated built-in tools as a mostly fixed set. P032 moves tool availability into user-visible configuration and introduces trusted JavaScript package plugins.

This feature must preserve a few important architectural properties:

- tool configuration is owned by core, not duplicated per frontend
- Web and TUI are thin clients over shared protocol methods
- bad plugin packages must not crash the server
- empty config must preserve current behavior
- system-critical tools must remain available even under misconfiguration

## Decisions Already Made

- Plugin execution is fully trusted.
- Both Web and TUI need first-class support.
- Tool lifecycle hooks are out of scope for this phase.
- Sandboxing and permissions for plugins are out of scope for this phase.
- Hot reload and watch mode for plugin code are out of scope for this phase.

## Recommended Product Decisions

These decisions meaningfully affect implementation shape. This plan assumes the following defaults:

1. **Tool settings are project-local in MVP**
   - Write to `.diligent/config.jsonc` for the active project.
   - Rationale: tool availability is strongly tied to project context and local package resolution.
   - Follow-up work can add global/shared tool profiles later if desired.

2. **Plugin packages must already be installed and resolvable**
   - Diligent config can reference a package.
   - Diligent does not install npm packages for the user in MVP.
   - If a package is missing, it appears in settings with a load error.

3. **No plugin discovery beyond configured packages**
   - Diligent only loads packages explicitly listed in config.
   - There is no filesystem scanning or npm registry search in MVP.

4. **Immutable built-ins cannot be overridden by plugins**
   - Even with `plugin_wins`, immutable built-ins still win.
   - This keeps `plan` and `request_user_input` reliably available.

## Goals

1. Add configurable enable/disable controls for built-in tools.
2. Add plugin package loading and per-package/per-tool enable/disable controls.
3. Keep system-critical tools immutable.
4. Expose tool configuration through shared protocol methods.
5. Implement settings UX in both Web and TUI.
6. Ensure plugin failures remain non-fatal and clearly visible.
7. Preserve current behavior when `tools` config is omitted.

## Non-Goals

1. No MCP integration work.
2. No sandboxing or permission isolation for plugins.
3. No lifecycle hook system such as `tool.definition`, `tool.execute.before`, or `tool.execute.after`.
4. No auto-installation of plugin packages.
5. No plugin hot reload or file watching.
6. No remote plugin marketplace or discovery UI.

## Invariants and Constraints

The implementation should enforce the following invariants:

- `plan` and `request_user_input` always remain enabled.
- collab tools remain system-managed and are not user-configurable in this phase.
- built-in tool names stay stable and are the configuration keys.
- changes apply on the next turn, not mid-turn.
- tool settings UI must clearly explain the full-trust plugin model.
- config updates must preserve JSONC comments and formatting where practical.

## User-Facing Workflow

### Built-in tools

- User opens tool settings.
- User disables a non-critical built-in such as `bash` or `grep`.
- Save succeeds.
- UI confirms: changes apply on next turn.
- Next turn resolves tools without the disabled built-in.

### Plugin packages

- User adds a package name such as `@acme/diligent-tools`.
- Diligent attempts to load it on the next list/build cycle.
- If the package loads, its tools appear under that package.
- User can disable the whole package or specific tools inside it.
- If the package is missing or invalid, the package remains visible with an error state.

### Immutable/system tools

- User sees immutable tools as enabled but non-toggleable.
- If config tries to disable them, the effective state still shows them as enabled with a reason.

## Config Model

## Stored config shape

```jsonc
{
  "tools": {
    "builtin": {
      "bash": false,
      "grep": false
    },
    "plugins": [
      {
        "package": "@acme/diligent-tools",
        "enabled": true,
        "tools": {
          "jira_comment": false
        }
      }
    ],
    "conflictPolicy": "error"
  }
}
```

## Normalization rules

The persisted config should represent **user intent**, not a full copy of effective state.

- built-in tools default to enabled
  - persist only `false` overrides for built-ins
- plugin packages default to not loaded unless present in `tools.plugins`
  - a package entry must remain in config if the user wants the package available
- plugin tools default to enabled once the package itself is enabled
  - persist only `false` overrides for plugin tools
- omit `conflictPolicy` when using default `error`
- package names must be unique in config
  - duplicate package entries should be normalized or rejected by server-side validation

## Config write semantics

`tools/set` should behave as an upsert/patch operation over the `tools` subtree.

Recommended behavior:

- update only the `tools` section in project config
- preserve unrelated config sections and comments
- create `.diligent/config.jsonc` if missing
- return normalized effective state after write

## Resolution Semantics

## Tool categories

There are three operational categories:

1. **Configurable built-ins**
   - `bash`, `read`, `write`, `edit`, `ls`, `glob`, `grep`, `add_knowledge`, and similar user-facing tools
2. **Immutable built-ins**
   - currently `plan`, `request_user_input`
3. **System-managed collab tools**
   - spawned-agent/collab tools added separately and not surfaced in settings for this phase

## Resolution pipeline

The effective pipeline should be:

1. Build built-in tool catalog.
2. Mark immutable built-ins.
3. Load configured plugin packages.
4. Validate plugin manifests and returned tools.
5. Reject duplicate tool names inside the same plugin package.
6. Resolve built-in vs plugin name conflicts.
7. Apply immutable enforcement.
8. Apply package-level enabled state.
9. Apply per-tool enabled state.
10. Produce:
    - final enabled `Tool[]` for runtime
    - detailed tool state metadata for UI
    - detailed plugin state metadata for UI

## Conflict policy

Supported policies:

- `error`
  - built-in wins
  - plugin tool is dropped
  - metadata records a conflict error
- `builtin_wins`
  - built-in wins silently or with non-fatal note
- `plugin_wins`
  - plugin replaces non-immutable built-in
  - immutable built-ins still win

## Deterministic ordering

Ordering should be stable so UI does not jump around:

- built-ins keep declared core order
- plugin packages keep config order
- plugin tools keep package export order after validation

## Required metadata for UI

The current `ToolStateEntry` shape is too thin for complete settings UX. Expand the effective metadata to include explicit reasons and plugin/package state.

Recommended fields:

### Tool-level

- `name`
- `source`: `builtin` or `plugin`
- `pluginPackage?`
- `enabled`
- `immutable`
- `configurable`
- `available`
- `reason?`
  - `enabled`
  - `disabled_by_user`
  - `immutable_forced_on`
  - `plugin_disabled`
  - `plugin_load_failed`
  - `conflict_dropped`
  - `invalid_plugin_tool`
- `error?`

### Plugin-level

- `package`
- `configured`
- `enabled`
- `loaded`
- `toolCount`
- `loadError?`
- `warnings?`

This richer metadata is what should back Web/TUI rendering, not ad hoc frontend logic.

## Plugin Package Contract

## Package entry requirements

A plugin package must be importable by the running server process and export:

```ts
export const manifest = {
  name: "@acme/diligent-tools",
  apiVersion: "1.x",
  version: "0.1.0",
};

export async function createTools(ctx) {
  return [
    // Diligent Tool objects
  ];
}
```

## MVP validation requirements

- `manifest` must exist
- `manifest.name` must match configured package name
- `manifest.apiVersion` must be compatible with supported major version
- `manifest.version` must exist
- `createTools` must exist and return an array
- each returned tool must satisfy the Diligent tool shape
- duplicate tool names returned by one plugin should be rejected

## Minimal plugin context

Keep plugin context intentionally small in MVP:

```ts
{
  cwd: string;
}
```

Do not add lifecycle hooks or broad host services in this phase.

## Studiorpc retrospective: plugin contract gaps for next iteration

Studiorpc was useful as a real plugin-authoring exercise because it exposed where the current contract is technically usable but still awkward to build against. This is not a request to expand the contract immediately inside P032; it is evidence for the next plugin-contract / SDK iteration.

### Novel perspective: the thirdparty plugin acted as a shadow integration test suite

One useful way to read the Studiorpc work is as a shadow integration test suite for P032.

Internal tests validate that the runtime can load plugin packages, validate shapes, and execute tools through the current host pathway. What they do not validate is whether the contract is actually pleasant, legible, and self-consistent for a plugin author working outside the core/runtime tree.

The recent Studiorpc development arc is the first substantial real-world exercise of that boundary inside this repo. That matters because `thirdparty/` has mostly sat outside normal architecture review scope, even though it is the best available proxy for how a real external plugin author experiences the system.

In that sense, Studiorpc revealed integration failures that unit tests and end-to-end tests would not naturally catch:

- whether a plugin author can import stable public types instead of redeclaring them
- whether approval semantics are clear enough to use consistently across plugins
- whether render payloads are typed enough to author safely
- whether common file I/O and host-interaction patterns are reusable instead of repeatedly rebuilt

Two concrete signs of friction already exist in the repo:

- `thirdparty/overdare/plugins/plugin-studiorpc/src/tool-types.ts`
  - redeclares 54 lines of host-facing tool types instead of importing a stable public contract
- `packages/runtime/src/tools/plugin-loader.ts`
  - currently wraps plugin execution with a legacy compatibility shim before calling `tool.execute(...)`
- `thirdparty/overdare/plugins/plugin-studiorpc/src/tools/instance-upsert-tool.ts`
  - manages file I/O, RPC calls, and approval flows directly, reproducing patterns that exist in built-in tooling but are not exposed as reusable plugin utilities

Those are strong signals that the contract is not yet cleanly consumable as a package boundary.

### 1. Approval semantics are underspecified at the plugin boundary

Studiorpc needed to understand what `approve()` really means in practice, but the current contract is still too thin:

- approval requests expose only broad permissions such as `read`, `write`, and `execute`
- response values such as `once` and `always` are host-oriented but do not define plugin-visible scope clearly
- Studiorpc ended up inventing its own approval model around those broad permission buckets because no richer structured approval API exists
- the contract does not state whether `always` means:
  - for this tool call only
  - for the current turn
  - for the current plugin tool
  - for future calls with similar arguments
- plugin authors do not have a standard way to describe approval intent in a structured, user-friendly way beyond free-form `description` and optional `details`

Implication for the next iteration:

- define approval scope explicitly in the public plugin contract
- specify which approval dimensions are stable for plugins to rely on
- provide a richer approval request shape oriented around user-facing intent, not only internal permission buckets

### 2. Render payload types are usable internally but weak as public SDK types

Studiorpc also highlighted that render payloads are not yet ergonomic as a plugin-facing contract:

- `ToolRenderPayload.blocks` is currently `Array<Record<string, unknown>>`
- plugin authors must infer the allowed block shapes from host behavior rather than a discriminated public type model
- this makes plugin rendering possible, but not self-documenting or strongly typed

Implication for the next iteration:

- publish render block types as a stable SDK surface
- use discriminated unions for supported block variants instead of unbounded records
- clarify which render payload fields are required, optional, and forward-compatible for plugins

### 3. Plugin authors lack shared I/O utilities

Studiorpc had to bridge host interaction patterns manually because the plugin contract exposes raw primitives but not the higher-level helpers authors actually need:

- no shared utility layer for common approval + execution flows
- no standard helpers for structured output/render assembly
- no host-provided convenience wrappers for repetitive request/response patterns
- non-trivial tools such as `instance-upsert-tool.ts` must compose local file mutation, remote RPC invocation, and host approval sequencing entirely on their own

This pushes each plugin toward bespoke glue code, which increases duplication and drift.

Implication for the next iteration:

- introduce a plugin SDK package with reusable helpers rather than exposing only structural types
- keep the runtime contract narrow, but provide optional authoring utilities on top of it
- treat “can technically call host functions” and “pleasant to author a plugin” as separate goals

### 4. `ToolContext` is too narrow for real plugin development

The current MVP context was intentionally minimal, but Studiorpc showed that minimality alone is not the right long-term package contract:

- plugins need more than `cwd` plus ad hoc host callbacks once they become non-trivial
- the runtime currently relies on a compatibility shim to extend the execution context for legacy expectations
- this suggests the public context shape is lagging behind real host capabilities

Likely expansion areas for the next iteration:

- a stable request/response surface for approvals and user input
- clearer progress / partial-update reporting semantics
- host utilities for common file or command I/O patterns where the host wants to preserve policy control
- explicit versioning of `ToolContext` capabilities so plugins can feature-detect rather than copy internal types

### Retrospective conclusion

P032 remains valid as the MVP plugin-packages feature. However, Studiorpc demonstrates that “runtime-loadable plugin tools” and “clean public plugin SDK” are not the same milestone.

The key architectural lesson is that P032 got the trust boundary mostly right, but not yet the authoring surface. A plugin contract can be intentionally decoupled from `@diligent/core` while still offering a real public SDK.

That SDK does not need to be `@diligent/core`. A thinner `@diligent/plugin-sdk` package would likely be the better direction: it could export only the stable plugin-facing types and optional utilities, while preserving the runtime's internal freedom to evolve.

The next iteration should therefore treat the plugin contract as a first-class product surface with at least four follow-up themes:

1. approval semantics with explicit scope and author guidance
2. stable typed render payload/block contracts
3. shared plugin SDK utilities for common I/O and rendering work
4. an expanded, versioned `ToolContext` that reflects real host interaction needs

That work can be planned separately without reopening the MVP scope of P032.

## Failure isolation

Any of the following must be non-fatal:

- package import failure
- missing manifest
- manifest/version mismatch
- `createTools()` throw
- invalid tool shape
- duplicate tool names

A bad plugin should result in visible package/tool errors, not app-server failure.

## Protocol and Shared API

Add new shared client request methods:

- `tools/list`
- `tools/set`

These should live beside the existing request schemas in `packages/protocol/src/methods.ts` and `packages/protocol/src/client-requests.ts`.

## `tools/list` params

Recommended shape:

```ts
{
  threadId?: string;
}
```

Reason for optional `threadId`:

- it matches existing app-server stateful methods
- it allows the server to resolve the correct project/cwd context
- it avoids assuming one global tool state across all threads

## `tools/list` response

Recommended shape:

```ts
{
  configPath: string;
  appliesOnNextTurn: true;
  trustMode: "full_trust";
  conflictPolicy: "error" | "builtin_wins" | "plugin_wins";
  tools: ToolDescriptor[];
  plugins: PluginDescriptor[];
}
```

This should include enough metadata to render both Web and TUI without extra local derivation.

## `tools/set` params

Recommended patch shape:

```ts
{
  threadId?: string;
  builtin?: Record<string, boolean>;
  plugins?: Array<{
    package: string;
    enabled?: boolean;
    tools?: Record<string, boolean>;
    remove?: boolean;
  }>;
  conflictPolicy?: "error" | "builtin_wins" | "plugin_wins";
}
```

Notes:

- `remove: true` is needed so the UI can delete a plugin package entry entirely, not only disable it.
- package patches should merge by `package` name.
- server returns the full normalized effective state after write.

## App-Server and Runtime Changes

## Important current gap

`createAppServerConfig()` currently closes over `runtimeConfig`, and `buildAgentConfig()` reads `runtimeConfig.diligent.tools` when building the next turn config.

That means `tools/set` cannot be treated as a pure disk write. The server must also ensure next-turn resolution sees the updated tool config.

## Recommended runtime behavior

For MVP, choose one of these approaches and implement it consistently:

1. **Mutate in-memory runtimeConfig after write**
   - simplest
   - enough if changes only come through app-server methods
2. **Reload config from disk before each tool build**
   - more robust
   - slightly broader change

Recommended MVP path: **mutate in-memory runtimeConfig on `tools/set`** and keep full per-turn runtime reload as a later refactor if needed.

## Server responsibilities

`packages/core/src/app-server/server.ts` should:

- expose `tools/list`
- expose `tools/set`
- resolve the correct cwd/config path
- use shared core helpers for read/normalize/write
- return effective state after immutable/conflict enforcement
- preserve non-fatal plugin errors in the response payload
- include the next-turn apply notice in the response model

## Shared core helpers to add

Recommended new helpers in core:

- `packages/core/src/config/writer.ts`
  - JSONC-preserving write helpers for `tools` subtree
- `packages/core/src/tools/state.ts` or expand `catalog.ts`
  - normalized state builders for protocol responses
- optional `packages/core/src/tools/plugin-types.ts`
  - shared metadata/result types if `catalog.ts` becomes too dense

## UI Plan

## Web

Add `ToolSettingsModal` modeled after the provider settings flow, but backed by `tools/list` and `tools/set`.

### Web UX requirements

- entry point from an obvious settings surface near existing provider settings
- trust warning text
- built-in tools section
- immutable tools shown as locked/disabled controls
- plugin packages section
- add-package input
- remove-package action
- per-package enable/disable toggle
- nested plugin tool toggles
- plugin load error banners
- next-turn apply notice after save

### Recommended Web interaction model

- fetch `tools/list` when opening modal
- allow local edits in modal state
- save explicitly via one `tools/set` call
- refetch effective state after save

This keeps the UI simple and avoids partial writes while the user is still editing.

## TUI

Add a `/tools` command backed by the same protocol methods.

### TUI UX requirements

- `/tools` opens tool settings
- top-level sections for built-ins and plugin packages
- plugin add flow via text input
- per-package enter/select to inspect plugin tools
- immutable tools visible but non-toggleable
- load errors visible inline
- save confirmation with “applies on next turn” feedback

### Recommended TUI interaction model

Keep the first implementation simple:

1. top-level list picker for built-ins and plugin packages
2. selecting a plugin package opens a second picker for its tool list
3. adding a package uses a text-input overlay
4. save goes through `tools/set`

Avoid building a complex tree widget in MVP.

## Frontend Architecture Requirement

Even if Web and TUI differ visually, both must use the same app-server RPC methods for listing and saving tool settings. Do not implement a separate TUI-only direct file writer path for this feature.

## Detailed Implementation Tasks

## Task 0 — Reconcile plan with current groundwork

Update the implementation plan and task boundaries to reflect that core schema/catalog/plugin-loader groundwork already exists.

### Acceptance

- plan document reflects current repository state
- remaining tasks are phrased as completion/hardening work, not greenfield work

## Task 1 — Harden core catalog and plugin loading

Refine the existing core implementation so it is safe and expressive enough for UI and protocol use.

### Status

Done on 2026-03-07.

Implemented in repo:

- `packages/core/src/tools/plugin-loader.ts`
  - validates `manifest.name === configured package`
  - supports async `createTools()`
  - rejects non-array `createTools()` results
  - rejects duplicate tool names inside one plugin package while keeping the package non-fatal
  - returns structured warning and invalid-tool metadata for partial failures
- `packages/core/src/tools/catalog.ts`
  - prevents immutable built-ins from being overridden even under `plugin_wins`
  - expands tool metadata with `configurable`, `available`, `reason`, and `error`
  - adds separate plugin package metadata via `PluginStateEntry`
  - excludes collab tools from user-configurable catalog state
  - preserves deterministic ordering: built-ins first, then plugin packages in config order, then package tool order
- tests updated:
  - `packages/core/src/tools/__tests__/plugin-loader.test.ts`
  - `packages/core/src/tools/__tests__/catalog.test.ts`

### Subtasks

1. validate `manifest.name === configured package`
2. reject duplicate tool names inside the same plugin package
3. prevent immutable built-ins from being overridden even under `plugin_wins`
4. expand metadata beyond the current minimal `ToolStateEntry`
5. separate plugin package status from tool-level status cleanly
6. ensure collab tools remain excluded from user-configurable state
7. add deterministic ordering guarantees

### Acceptance

- unit tests cover each rule above
- empty config still returns current default behavior
- plugin failures remain non-fatal

### Verification

Passed on 2026-03-07:

- `bun test packages/core/src/tools/__tests__/plugin-loader.test.ts`
- `bun test packages/core/src/tools/__tests__/catalog.test.ts`

## Task 2 — Add config writer support for tools

Create shared JSONC-preserving write helpers in core for the `tools` subtree.

### Status

Done on 2026-03-07.

Implemented in repo:

- new `packages/core/src/config/writer.ts`
  - adds project-local config path helper for `.diligent/config.jsonc`
  - patches only the `tools` subtree via `jsonc-parser` `modify()`/`applyEdits()`
  - creates config file/directories when missing
  - supports builtin toggle updates plus plugin add/update/remove patch semantics
  - normalizes persisted config to user-intent form
    - built-in toggles store only `false`
    - plugin package presence is preserved as intent to keep the package configured
    - plugin tool toggles store only `false`
    - default `conflictPolicy: "error"` is omitted
    - empty normalized `tools` removes the `tools` subtree entirely
  - validates and returns parsed config after write
- exports added through:
  - `packages/core/src/config/index.ts`
  - `packages/core/src/index.ts`
- tests added:
  - `packages/core/src/config/__tests__/writer.test.ts`

### Subtasks

1. add writer helper that can create `.diligent/config.jsonc`
2. patch only the `tools` subtree
3. support add/update/remove plugin package operations
4. normalize stored config to minimal user-intent form
5. return normalized effective state after write

### Acceptance

- unrelated config sections remain intact
- existing comments are preserved where `jsonc-parser` allows
- plugin removal is supported

### Verification

Passed on 2026-03-07:

- `bun test packages/core/src/config/__tests__/writer.test.ts`
- `bun test packages/core/src/config/__tests__/schema.test.ts`
- `bun test packages/core/src/tools/__tests__/catalog.test.ts packages/core/src/config/__tests__/writer.test.ts packages/core/src/config/__tests__/schema.test.ts`
- `bunx tsc --noEmit -p packages/core/tsconfig.json`

## Task 3 — Expose `tools/list` and `tools/set` in protocol

Add request constants and typed schemas.

### Status

Done on 2026-03-07.

Implemented in repo:

- `packages/protocol/src/methods.ts`
  - adds `tools/list` and `tools/set` client request constants
- `packages/protocol/src/client-requests.ts`
  - adds `ToolsListParamsSchema`
  - adds `ToolsSetParamsSchema`
  - adds richer shared response schemas for UI consumption:
    - `ToolConflictPolicySchema`
    - `ToolStateReasonSchema`
    - `ToolDescriptorSchema`
    - `PluginDescriptorSchema`
    - `ToolsListResponseSchema`
    - `ToolsSetResponseSchema`
  - wires both methods into `DiligentClientRequestSchema` and `DiligentClientResponseSchema`
- `packages/protocol/src/index.ts`
  - new schemas/types are re-exported through the package index via `client-requests.ts`
- `packages/protocol/test/protocol-flow.test.ts`
  - adds positive coverage for `tools/list` and `tools/set` request/response payloads
  - adds negative coverage for malformed tool protocol payloads

### Subtasks

1. add method constants in `packages/protocol/src/methods.ts`
2. add Zod schemas and types in `packages/protocol/src/client-requests.ts`
3. export new types from protocol index
4. add or update protocol tests if present

### Acceptance

- typed request/response coverage exists for both methods
- response models are sufficient for both Web and TUI

### Verification

Passed on 2026-03-07:

- `bun test packages/protocol/test/protocol-flow.test.ts packages/protocol/test/protocol-jsonrpc.test.ts`
- `bunx tsc --noEmit -p packages/protocol/tsconfig.json`

## Task 4 — Implement app-server handlers

Add request handling and in-memory refresh semantics.

### Status

Done on 2026-03-07.

Implemented in repo:

- `packages/core/src/app-server/server.ts`
  - adds `tools/list` request handling
  - adds `tools/set` request handling
  - includes `tools/list` / `tools/set` in thread-scoped default threadId injection
  - resolves cwd/project context from thread runtime when available, otherwise from server cwd
  - returns shared effective tool/plugin metadata for UI consumption
  - keeps plugin failures non-fatal by returning them in tool/plugin state metadata rather than surfacing fatal request errors
- `packages/core/src/app-server/factory.ts`
  - adds `toolConfig` manager bridge over `runtimeConfig.diligent.tools`
  - updates in-memory runtime config after successful `tools/set` writes
  - ensures subsequent `buildAgentConfig()` calls see updated tool settings on the next turn without restart
- `packages/core/src/tools/defaults.ts`
  - now returns `pluginState` alongside `toolState` so app-server responses can expose both tool-level and plugin-level state cleanly
- tests updated:
  - `packages/core/test/app-server.test.ts`
  - `packages/core/test/app-server-factory.test.ts`

### Subtasks

1. implement `tools/list`
2. implement `tools/set`
3. update runtime config after successful writes
4. ensure next turn uses new settings
5. return effective tool/plugin state including errors and immutable notes

### Acceptance

- `tools/set` changes are visible on the next turn without restart
- plugin errors are returned, not thrown as fatal server errors
- thread/cwd resolution matches expected project context

### Verification

Passed on 2026-03-07:

- `bun test packages/core/test/app-server.test.ts packages/core/test/app-server-factory.test.ts`
- `bunx tsc --noEmit -p packages/core/tsconfig.json`

## Task 5 — Web settings UI

Build the initial Web settings experience.

### Status

Done on 2026-03-07.

Implemented in repo:

- new `packages/web/src/client/components/ToolSettingsModal.tsx`
  - loads effective state through shared `tools/list`
  - edits built-ins and plugin package/tool toggles locally in modal state
  - supports add/remove package flows
  - shows immutable, unavailable, warning, and load-error states
  - shows full-trust warning and next-turn apply notice
- `packages/web/src/client/App.tsx`
  - wires modal open/close state
  - adds shared RPC callbacks for `tools/list` / `tools/set`
- `packages/web/src/client/components/Sidebar.tsx`
  - adds Tool settings entry point near existing provider settings controls
- tests updated:
  - `packages/web/test/components.test.tsx`
  - `packages/web/test/rpc-client.test.ts`

### Subtasks

1. create `ToolSettingsModal`
2. add open/close wiring in `App.tsx` and relevant controls
3. add RPC client methods
4. implement add/remove/toggle flows
5. render immutable and error states clearly
6. show trust warning and next-turn apply message

### Acceptance

- user can disable a built-in
- user can add a plugin package
- user can disable a plugin package
- user can disable a specific plugin tool
- load failures are visible and non-fatal

## Task 6 — TUI settings UI

Build the corresponding TUI flow using the same protocol surface.

### Status

Done on 2026-03-07.

Implemented in repo:

- new `packages/cli/src/tui/commands/builtin/tools.ts`
  - adds `/tools` command backed by shared `tools/list` / `tools/set`
  - supports built-in toggles, plugin add/remove, package enable/disable, and per-tool toggles
  - uses existing `ListPicker` and `TextInput` overlay patterns
  - prints trust and next-turn apply guidance in chat output
- `packages/cli/src/tui/commands/builtin/index.ts`
  - registers `/tools`
- `packages/cli/src/tui/command-handler.ts`
  - exposes rpc client access through `CommandContext.app`
- tests added:
  - `packages/cli/src/tui/commands/__tests__/tools.test.ts`

### Subtasks

1. add `/tools` command
2. add add-package text-input flow
3. add top-level picker for built-ins and packages
4. add nested picker for plugin tools
5. wire save through RPC
6. print or display “applies on next turn” feedback

### Acceptance

- TUI can perform the same core operations as Web
- immutable tools cannot be toggled
- plugin/package errors are visible

## Task 7 — Documentation and example plugin guidance

Add enough documentation so the feature is usable.

### Status

Done on 2026-03-07.

Implemented in repo:

- new `docs/tool-settings.md`
  - documents project-local storage, trust model, config format, conflict policy, load failures, and current limitations
  - includes a minimal compatible plugin package example
- `README.md`
  - adds a top-level Tool settings section linking to the new doc

### Subtasks

1. update user docs for tool settings
2. document trust model explicitly
3. document how plugin packages are resolved
4. provide a minimal example plugin package snippet
5. document limitations and non-goals

### Acceptance

- users can understand how to add a package and why it may fail to load
- plugin authors can create a minimal compatible package

## Task 8 — End-to-end verification

Add tests across the stack.

### Status

Done on 2026-03-07.

Implemented in repo:

- Web tests:
  - `packages/web/test/components.test.tsx`
    - tool settings modal static render coverage for trust warning and tool/plugin rows
  - `packages/web/test/rpc-client.test.ts`
    - shared Web RPC request coverage for `tools/list` and `tools/set`
- TUI tests:
  - `packages/cli/src/tui/commands/__tests__/tools.test.ts`
    - draft normalization, `tools/set` patch shaping, and built-in command registration
- E2E tests:
  - `packages/e2e/helpers/server-factory.ts`
    - upgraded to create app-server configs with real tool-config support
  - `packages/e2e/mode-and-config.test.ts`
    - protocol-level `tools/list` / `tools/set` coverage
    - verifies changed tool availability applies on the next turn

### Core tests

- built-in disable works
- immutable built-ins remain enabled
- plugin package disabled at package level
- plugin tool disabled at tool level
- duplicate package names handled correctly
- duplicate tool names inside one plugin rejected
- immutable built-in cannot be overridden
- conflict policy behavior for `error`, `builtin_wins`, `plugin_wins`
- `manifest.name` mismatch rejected

### App-server tests

- `tools/list` returns effective state
- `tools/set` persists config
- `tools/set` supports plugin removal
- next turn reflects changed tool availability
- bad plugin package does not crash request handling

### Web tests

- modal renders tool and plugin state
- add/remove/toggle flows call RPC correctly
- immutable rows render disabled state
- plugin errors render visibly

### TUI tests

- `/tools` command wiring
- add/remove/toggle flows produce expected RPC calls
- immutable rows cannot be toggled

### E2E tests

- protocol-level flow for `tools/list` and `tools/set`
- next-turn application after a tool toggle
- plugin load failure visible without turn failure

## Planned File Areas

## Existing files likely to change

### Core

- `packages/core/src/config/schema.ts`
- `packages/core/src/config/runtime.ts`
- `packages/core/src/tools/defaults.ts`
- `packages/core/src/tools/catalog.ts`
- `packages/core/src/tools/plugin-loader.ts`
- `packages/core/src/tools/immutable.ts`
- `packages/core/src/app-server/factory.ts`
- `packages/core/src/app-server/server.ts`

### Protocol

- `packages/protocol/src/methods.ts`
- `packages/protocol/src/client-requests.ts`
- `packages/protocol/src/index.ts`

### Web

- `packages/web/src/client/App.tsx`
- `packages/web/src/client/lib/rpc-client.ts`
- `packages/web/src/client/components/ProviderSettingsModal.tsx` as UX reference
- new `packages/web/src/client/components/ToolSettingsModal.tsx`

### TUI

- `packages/cli/src/tui/commands/builtin/`
- `packages/cli/src/tui/components/list-picker.ts`
- `packages/cli/src/tui/components/text-input.ts`

## New files likely needed

- `packages/core/src/config/writer.ts`
- optional metadata/type helpers under `packages/core/src/tools/`
- Web modal component for tool settings
- new tests across core, app-server, web, cli, and e2e layers

## Risks and Mitigations

1. **Tool name collisions are confusing**
   - Mitigation: explicit conflict policy, clear metadata, stable UI error messaging.

2. **Plugin packages fail to load for mundane reasons**
   - Mitigation: keep broken package entries visible with load errors and do not crash the app.

3. **Config writes do not affect next turn in-process**
   - Mitigation: explicitly refresh or mutate in-memory runtime config after `tools/set`.

4. **Frontend logic drifts between Web and TUI**
   - Mitigation: both clients consume the same protocol response model.

5. **Users misunderstand full-trust plugins**
   - Mitigation: place trust warning in settings UI and docs, not only in internal notes.

6. **UI complexity grows too quickly**
   - Mitigation: use a modal in Web and a simple two-level picker flow in TUI for MVP.

## Recommended Implementation Order

1. Task 1 — harden current core groundwork
2. Task 2 — add config writer support
3. Task 3 — add protocol request/response types
4. Task 4 — add app-server handlers and runtime refresh
5. Task 5 — build Web UI
6. Task 6 — build TUI UI
7. Task 7 — write docs/example plugin guidance
8. Task 8 — finish protocol/E2E verification

## Exit Criteria

P032 can be considered complete when all of the following are true:

1. users can disable non-critical built-in tools
2. users can add configured plugin packages without manual JSON editing
3. users can enable/disable plugin packages and individual plugin tools
4. immutable tools always remain enabled
5. Web and TUI both manage the feature through shared protocol methods
6. config updates apply on the next turn without restart
7. plugin load/init/validation failures are visible and non-fatal
8. automated tests cover core, server, and at least one end-to-end flow
