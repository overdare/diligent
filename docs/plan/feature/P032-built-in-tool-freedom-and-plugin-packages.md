---
id: P032
status: pending
created: 2026-03-05
---

# P032: Built-in Tool Freedom + JavaScript Package Tool Plugins

## Context

Diligent currently builds tools from a fixed default list (`buildDefaultTools`) and does not provide a first-class user configuration layer for tool availability.

The target direction is:

1. Let users disable selected built-in tools.
2. Load JavaScript packages as tools through a plugin mechanism.
3. Provide a configuration UI in both Web and TUI.

Session decisions already made:
- Design-first (no immediate implementation in this step)
- UI support in both Web and TUI
- Plugin execution model is **fully trusted** (host-equivalent permissions)

## Goals

1. Add configurable enable/disable controls for built-in tools.
2. Add plugin package loading and per-plugin/per-tool enable/disable controls.
3. Keep system-critical tools immutable (not disable-able).
4. Surface configuration through a shared protocol and both clients (Web + TUI).
5. Keep failure isolation: bad plugins must not crash the entire app.

## Non-Goals

1. No MCP extension work in this plan.
2. No sandbox or permission isolation for plugin execution (full trust model selected).
3. No tool lifecycle hook system in this phase (`tool.definition`, `tool.execute.before`, `tool.execute.after` are explicitly out of scope).
4. No hot-reload/watch mode for plugin code in MVP.

## Reference Notes (opencode)

Patterns borrowed from opencode reference:
- Dynamic tool loading from external sources.
- Deterministic naming and conflict handling.
- Custom tools can coexist with built-ins.

Pattern intentionally excluded for now:
- Tool lifecycle hooks.

## Design

### 1) Config Schema Extension

Extend `DiligentConfigSchema` with a `tools` section:

```jsonc
{
  "tools": {
    "builtin": {
      "bash": true,
      "grep": false
    },
    "plugins": [
      {
        "package": "@acme/diligent-tools",
        "enabled": true,
        "tools": {
          "jira_search": true,
          "jira_comment": false
        }
      }
    ],
    "conflictPolicy": "error"
  }
}
```

Default behavior when omitted:
- Built-in tools remain enabled (current behavior).
- No plugins are loaded.
- Conflict policy defaults to `error`.

### 2) Immutable Built-in Tools

Add a hardcoded immutable allowlist in core for system-critical tools.

Initial immutable set:
- `request_user_input`
- `plan`

Rules:
- Immutable tools always stay enabled.
- Config attempts to disable immutable tools are ignored.
- Ignored attempts are reported in tool-state metadata for UI visibility.

### 3) Plugin Package Contract

Each plugin package exports a minimal contract:

```ts
export const manifest = {
  name: "@acme/diligent-tools",
  apiVersion: "1.x",
  version: "0.1.0"
};

export async function createTools(ctx) {
  return [
    // Diligent Tool objects
  ];
}
```

Validation requirements:
- `manifest.name` must match configured package name.
- `manifest.apiVersion` must match supported range (`1.x`).
- Returned tools must satisfy Diligent `Tool` shape.

### 4) Tool Resolution Pipeline

Replace direct fixed assembly with a staged resolver:

1. Build built-in tool catalog.
2. Load plugin tools from configured packages.
3. Resolve name conflicts by policy.
4. Apply immutable enforcement.
5. Apply built-in/plugin/tool enabled state.
6. Return final `tools` array plus state metadata.

Conflict policies:
- `error` (default): fail conflicting tool registration, keep built-in.
- `builtin_wins`: keep built-in, drop plugin tool.
- `plugin_wins`: allow override.

### 5) Runtime Semantics

SessionManager already resolves `agentConfig()` per run/turn boundary; therefore:
- Changes apply to the next turn.
- In-flight turns are not mutated.

UI must show: **“Changes apply on next turn.”**

### 6) Failure Isolation

Plugin failures (import error, shape error, init error):
- Do not crash server/app.
- Mark plugin/tool as unavailable.
- Expose error details through tool state API for Web/TUI display.

## Protocol + API Changes

Add shared client request methods (not web-only):
- `tools/list`
- `tools/set`

### `tools/list` response shape

- All known tools with metadata:
  - `name`, `source` (`builtin`/`plugin`), `pluginPackage?`, `enabled`, `immutable`, `error?`
- Plugin-level status:
  - `package`, `enabled`, `loadError?`

### `tools/set` behavior

- Accept partial updates for built-ins/plugins/tool toggles.
- Persist to config file (`.diligent/diligent.jsonc` by default).
- Return normalized effective state after immutable enforcement.

## UI Plan

### Web

Add `ToolSettingsModal` (parallel to existing provider settings UX):
- Sections: Built-in / Plugins / Plugin Tools
- Toggle controls with disabled state for immutable tools
- Plugin load error banners
- Save/apply action
- Trust warning text: plugin code runs with host-equivalent permissions

### TUI

Add `/tools` command and picker-based editor:
- Sectioned list (built-in, plugin packages, plugin tools)
- Toggle via keyboard
- Immutable rows are non-toggleable with reason text
- Save writes config and prints “applies on next turn” feedback

## Planned File Areas

Core:
- `packages/core/src/config/schema.ts`
- `packages/core/src/tools/defaults.ts` (refactor entry point)
- New:
  - `packages/core/src/tools/catalog.ts`
  - `packages/core/src/tools/plugin-loader.ts`
  - `packages/core/src/tools/policy.ts`

Protocol:
- `packages/protocol/src/methods.ts`
- `packages/protocol/src/client-requests.ts`
- `packages/protocol/src/index.ts`

App server:
- `packages/core/src/app-server/server.ts` (`tools/list`, `tools/set` handlers)

Web:
- `packages/web/src/client/components/ToolSettingsModal.tsx`
- `packages/web/src/client/lib/rpc-client.ts`
- `packages/web/src/server/rpc-bridge.ts` (forwarding for new methods if needed)

TUI:
- `packages/cli/src/tui/commands/builtin/` (new `/tools` command)
- `packages/cli/src/tui/components/list-picker.ts` (reuse/extend)
- `packages/cli/src/config-writer.ts` (write helpers for tools config)

## Phased Implementation

### Phase 1 — Core Resolution Engine
- Add schema.
- Add catalog/loader/policy modules.
- Integrate into default tool builder.
- Unit tests for immutable, conflict policy, load failure isolation.

### Phase 2 — Protocol and Server Surface
- Add `tools/list`, `tools/set` protocol methods.
- Implement server handlers with config persistence.
- Integration tests for roundtrip state updates.

### Phase 3 — Web UI
- Build Tool settings modal.
- Hook into RPC requests.
- Display errors, immutable states, and next-turn apply message.

### Phase 4 — TUI UI
- Add `/tools` command with interactive list picker.
- Persist toggles.
- Confirm next-turn apply behavior.

## Verification

1. Existing behavior preserved with empty `tools` config.
2. Disabling non-immutable built-in removes it from available tool calls.
3. Immutable tools remain enabled even when set to false.
4. Plugin package loads and registers tools.
5. Plugin load failure is visible but non-fatal.
6. Per-plugin and per-tool toggles work correctly.
7. Web and TUI both can list and modify tool configuration.
8. Full test suite passes after integration.

## Risks and Mitigations

1. **Tool name collisions**
   - Mitigation: explicit conflict policy + default `error`.

2. **Plugin instability**
   - Mitigation: failure isolation and robust error reporting.

3. **Security expectations mismatch (full trust)**
   - Mitigation: explicit warnings in UI and docs.

4. **Config drift between clients**
   - Mitigation: shared protocol methods and normalized server-side state.
