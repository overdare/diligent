---
id: P008
status: done
created: 2026-03-02
---

status: done
---

# Plan: Model/Provider Selection UI + Token Usage Display

## Context
Web UI is missing model/provider selection and token usage display (both present in TUI). The protocol has a bug where `usage` AgentEvents are silently dropped in `DiligentAppServer.emitFromAgentEvent()`. No model info is sent to web clients.

## Approach
- **Token usage**: Protocol-level fix — add `usage/updated` server notification, forward from app-server
- **Model selection**: Web-specific — extend `ConnectedMessage` with model info, intercept `config/set` RPC at bridge level (no protocol-level config methods needed)

---

## Step 1: Protocol — Add `usage/updated` notification

**`packages/protocol/src/methods.ts`**
- Add `USAGE_UPDATED: "usage/updated"` to `DILIGENT_SERVER_NOTIFICATION_METHODS`

**`packages/protocol/src/server-notifications.ts`**
- Add `UsageUpdatedNotificationSchema` with params: `{ threadId, usage: UsageSchema, cost: z.number() }`
- Add to `DiligentServerNotificationSchema` union

## Step 2: Core — Forward usage events

**`packages/core/src/app-server/server.ts`** — `emitFromAgentEvent()`
- Add `case "usage":` that emits `USAGE_UPDATED` notification (currently falls through to `default: return`)

## Step 3: Web shared — Extend ConnectedMessage

**`packages/web/src/shared/ws-protocol.ts`**
- Add `ModelInfo` type: `{ id, provider, contextWindow, maxOutputTokens, inputCostPer1M?, outputCostPer1M?, supportsThinking? }`
- Extend `ConnectedMessage`: add `currentModel: string` and `availableModels: ModelInfo[]`

## Step 4: Web server — Model info + bridge-level switching

**`packages/web/src/server/rpc-bridge.ts`**
- Constructor accepts `modelConfig: { currentModelId, availableModels, onModelChange }`
- `open()`: include `currentModel` and `availableModels` in connected message
- `message()`: intercept `config/set` RPC requests before forwarding to app server, validate model ID, call `onModelChange`, return JSON-RPC response directly

**`packages/web/src/server/index.ts`**
- Import `KNOWN_MODELS`, `resolveModel` from `@diligent/core`
- Pass model config to `RpcBridge`: current model, available models list, and a setter that mutates `runtimeConfig.model`

## Step 5: Web client — State + RPC

**`packages/web/src/client/lib/rpc-client.ts`**
- Update `onConnected` callback type to include `currentModel` and `availableModels`

**`packages/web/src/client/lib/thread-store.ts`**
- Add `usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalCost }` to `ThreadState`
- Handle `"usage/updated"` notification: accumulate tokens and cost
- Reset usage in `hydrateFromThreadRead()`

**`packages/web/src/client/App.tsx`**
- Add `currentModel` and `availableModels` state from connected message
- Add `changeModel()` handler: `rpc.request("config/set", { model })` + optimistic update
- Pass model/usage props to InputDock

## Step 6: Web client — InputDock UI

**`packages/web/src/client/components/InputDock.tsx`**

Current bottom bar layout (after refactor):
- Left: `[·] connected · diligent/web`
- Right: `[mode ▾] [Send]`

New layout:
- Left: `[·] connected · diligent/web · 1.2k tokens · $0.03`
- Right: `[model ▾] [mode ▾] [Send]`

Changes:
- Add `currentModel`, `availableModels`, `onModelChange`, `usage` to `InputDockProps`
- Token display after cwd: `"1.2k tokens · $0.03"` — visible only when `inputTokens + outputTokens > 0`, with detailed tooltip showing breakdown
- Model selector: `<select>` with `<optgroup>` per provider, same styling as mode selector but with `max-w-[140px] truncate`
- Helper functions: `formatTokenCount()`, `formatUsageTooltip()`, `groupModelsByProvider()` — all local to InputDock

## Files modified (10)
1. `packages/protocol/src/methods.ts`
2. `packages/protocol/src/server-notifications.ts`
3. `packages/core/src/app-server/server.ts`
4. `packages/web/src/shared/ws-protocol.ts`
5. `packages/web/src/server/rpc-bridge.ts`
6. `packages/web/src/server/index.ts`
7. `packages/web/src/client/lib/rpc-client.ts`
8. `packages/web/src/client/lib/thread-store.ts`
9. `packages/web/src/client/App.tsx`
10. `packages/web/src/client/components/InputDock.tsx`

## Verification
- `bun run typecheck` — no type errors
- `bun test` — all tests pass
- Manual: start web server, verify model appears in status tray, switch model, send messages and verify token count updates
