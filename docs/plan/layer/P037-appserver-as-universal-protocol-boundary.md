---
id: P037
status: pending
created: 2026-03-07
updated: 2026-03-07
---

# AppServer as Universal Protocol Boundary

## Goal

Make `DiligentAppServer` the complete, self-contained protocol boundary for all clients.
After this plan lands:

- All protocol methods (`auth/*`, `config/set`, `thread/subscribe`, `image/upload`) are handled inside AppServer — not in a transport layer.
- AppServer is multi-connection aware: each connected peer (TUI stdio, browser WebSocket, Tauri WebView) gets its own connection with independent subscription routing.
- TUI and Web speak the exact same protocol. There is no `DILIGENT_WEB_REQUEST_METHODS` — only `DILIGENT_CLIENT_REQUEST_METHODS`.
- `RpcBridge` is deleted. The web server becomes a pure WebSocket transport + static file host.

## Context

P036 unified the wire format to raw JSON-RPC. The remaining asymmetry is that `DiligentAppServer` handles only the "core" methods and delegates Web-specific methods to `RpcBridge`. This split is artificial:

- `thread/subscribe` and `thread/unsubscribe` belong in AppServer because TUI is also a single subscriber — the concept is universal.
- `auth/*` and `config/set` belong in AppServer because TUI and Desktop also need to manage API keys and switch models at runtime.
- `image/upload` belongs in AppServer because it is a data management operation against `.diligent/`, which AppServer already owns.

The web server currently also duplicates notification routing, subscription bookkeeping, first-responder semantics, and session state — all of which should live inside the protocol boundary.

## Target Architecture

```
packages/core/src/app-server/
  DiligentAppServer
    ├── thread lifecycle          (existing)
    ├── turn management           (existing)
    ├── thread/subscribe|unsubscribe  (NEW — was RpcBridge)
    ├── config/set                (NEW — was RpcBridge)
    ├── auth/list|set|remove      (NEW — was RpcBridge)
    ├── auth/oauth/start          (NEW — was RpcBridge, injectable openBrowser)
    ├── image/upload              (NEW — was RpcBridge)
    ├── session defaults injection    (NEW — was RpcBridge.withSessionDefaults)
    └── notification routing per connection  (NEW — was RpcBridge)

packages/web/src/server/
  index.ts  — Bun HTTP server
    ├── /rpc  → WebSocket upgrade → appServer.connect(peer)
    ├── /health
    └── /images/*  → read-only file serving

  rpc-bridge.ts  — DELETED
  tools.ts       — unchanged
```

```
CLI / TUI
  └─ StdioRpcClient
      └─ diligent app-server --stdio
          └─ DiligentAppServer (connect via stdio peer)

Web Browser
  └─ WebRpcClient
      └─ WebSocket /rpc
          └─ Bun server (pure transport)
              └─ DiligentAppServer (connect via WS peer)
```

## Key Design Decisions

### Multi-connection inside AppServer

Replace the single `notificationListener` with a per-connection listener map. Each `connect()` call registers a peer with a connection ID. Notifications are routed to subscribed connections; server requests are broadcast first-responder style.

```typescript
// Before
private notificationListener: NotificationListener | null = null;

// After
private connections: Map<string, ConnectedPeer>;
// ConnectedPeer = { peer: RpcPeer; subscriptions: Set<string> }

connect(connectionId: string, peer: RpcPeer): () => void  // returns disconnect fn
```

`bindAppServer()` in core calls `appServer.connect()` and returns the disconnect function — API unchanged for callers.

#### Request dispatch with connectionId

Current `dispatchClientRequest(request)` signature changes to `dispatchClientRequest(connectionId, request)` so that per-connection operations (subscribe, turn initiator tracking, session defaults injection) have access to the originating connection. The `handleRequest` method receives `connectionId` from the `connect()` wiring:

```typescript
// connect() wires a per-connection onMessage handler:
connect(connectionId: string, peer: RpcPeer): () => void {
  // ...
  peer.onMessage = async (raw) => {
    // request → handleRequest(connectionId, raw)
    // response → resolve pending server request
  };
}

async handleRequest(connectionId: string, raw: unknown): Promise<JSONRPCResponse> {
  // parse, validate, then:
  const result = await this.dispatchClientRequest(connectionId, parsed.data);
}

private async dispatchClientRequest(
  connectionId: string,
  request: DiligentClientRequest,
): Promise<unknown> { ... }
```

#### emit() becomes connection-aware

Current `emit(notification)` calls single `notificationListener`. New `emit()` iterates `connections` map, applying routing rules:

```typescript
private emit(notification: DiligentServerNotification): void {
  const threadId = (notification.params as { threadId?: string }).threadId;

  if (!threadId) {
    // No threadId → broadcast to all
    for (const conn of this.connections.values()) {
      conn.peer.send(notification);
    }
    return;
  }

  // Find connections subscribed to this thread
  const subscribers = [...this.connections.values()]
    .filter(c => c.subscriptions.has(threadId));

  const targets = subscribers.length > 0
    ? subscribers
    : [...this.connections.values()];  // fallback: broadcast all

  for (const conn of targets) {
    // Skip turn initiator for userMessage notifications
    if (this.shouldSkipForInitiator(conn.id, threadId, notification)) continue;
    conn.peer.send(notification);
  }
}
```

### Session defaults injection (was RpcBridge.withSessionDefaults)

AppServer takes over the session defaults pattern currently in RpcBridge. Each `ConnectedPeer` tracks `cwd`, `mode`, `effort`, `currentThreadId`. Before dispatching a request, AppServer injects defaults from the connection's state:

```typescript
private applySessionDefaults(
  connectionId: string,
  method: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  const conn = this.connections.get(connectionId);
  if (!conn) return params;

  if (method === 'thread/start') {
    return {
      ...params,
      cwd: params.cwd ?? conn.cwd,
      mode: params.mode ?? conn.mode,
    };
  }

  // thread-scoped methods: inject threadId from currentThreadId
  const threadScoped = [
    'turn/start', 'turn/interrupt', 'turn/steer',
    'mode/set', 'effort/set', 'thread/read', 'knowledge/list',
  ];
  if (threadScoped.includes(method)) {
    return {
      ...params,
      threadId: (params.threadId as string)?.length > 0
        ? params.threadId
        : conn.currentThreadId,
    };
  }

  return params;
}
```

After `thread/start` and `thread/resume` succeed, update the connection's `currentThreadId`:

```typescript
// Inside dispatchClientRequest, after successful thread/start:
conn.currentThreadId = result.threadId;
// After successful thread/resume with found=true:
conn.currentThreadId = result.threadId;
```

### thread/subscribe is universal

TUI auto-subscribes to the active thread after `thread/start` or `thread/resume`. Web browser subscribes explicitly. AppServer routes `item/*`, `turn/*`, `thread/status/*` notifications only to sessions subscribed to that thread.

**Fallback policy:** If a threadId has zero subscribers, broadcast to all connections. This preserves backward compatibility and handles edge cases (e.g., notifications emitted between thread start and subscribe). Explicit `thread/unsubscribe` removes the subscription; subsequent notifications for that thread still reach the connection via the zero-subscriber broadcast fallback. This is intentional — unsubscribe means "stop targeted routing", not "block all notifications".

### Injectable dependencies for new methods

`DiligentAppServerConfig` gets optional injectable hooks so AppServer stays environment-neutral:

```typescript
interface DiligentAppServerConfig {
  // existing ...
  modelConfig?: {                           // for config/set
    allModels: ModelInfo[];
    getAvailableModels: () => ModelInfo[];
    onModelChange: (modelId: string) => void;
  };
  providerManager?: ProviderManager;        // for auth/*
  openBrowser?: (url: string) => void;      // for auth/oauth/start
  toImageUrl?: (absPath: string) => string; // for image/upload (web returns /images/... URL)
}
```

Dependency requirements per method:

| Method | Required dependency | Error if absent |
|---|---|---|
| `config/set` | `modelConfig` | `-32601 Method not found` |
| `auth/list` | `providerManager` + `modelConfig` | `-32601 Method not found` |
| `auth/set` | `providerManager` | `-32601 Method not found` |
| `auth/remove` | `providerManager` | `-32601 Method not found` |
| `auth/oauth/start` | `providerManager` + `openBrowser` | `-32601 Method not found` |
| `image/upload` | (none — uses `config.resolvePaths`) | always available |

### Protocol promotion

`DILIGENT_WEB_REQUEST_METHODS` is deleted. The methods move to `DILIGENT_CLIENT_REQUEST_METHODS`:

| Old location | Method | New location |
|---|---|---|
| `DILIGENT_WEB_REQUEST_METHODS` | `thread/subscribe` | `DILIGENT_CLIENT_REQUEST_METHODS` |
| `DILIGENT_WEB_REQUEST_METHODS` | `thread/unsubscribe` | `DILIGENT_CLIENT_REQUEST_METHODS` |
| `DILIGENT_WEB_REQUEST_METHODS` | `config/set` | `DILIGENT_CLIENT_REQUEST_METHODS` |
| `DILIGENT_WEB_REQUEST_METHODS` | `auth/list` | `DILIGENT_CLIENT_REQUEST_METHODS` |
| `DILIGENT_WEB_REQUEST_METHODS` | `auth/set` | `DILIGENT_CLIENT_REQUEST_METHODS` |
| `DILIGENT_WEB_REQUEST_METHODS` | `auth/remove` | `DILIGENT_CLIENT_REQUEST_METHODS` |
| `DILIGENT_WEB_REQUEST_METHODS` | `auth/oauth/start` | `DILIGENT_CLIENT_REQUEST_METHODS` |
| `DILIGENT_WEB_REQUEST_METHODS` | `image/upload` | `DILIGENT_CLIENT_REQUEST_METHODS` |

Schemas from `packages/protocol/src/web-requests.ts` move to `client-requests.ts`. `web-requests.ts` is deleted.

**Note:** `client-requests.ts` already imports `ModelInfoSchema` from `web-requests.ts` (used in `InitializeResponseSchema.availableModels`). When moving schemas, this import resolves naturally as `ModelInfoSchema` becomes local to `client-requests.ts`.

## Implementation Tasks

Task ordering rationale: Schema promotion (Task 1) comes first because subsequent tasks need the new method constants and schemas in `client-requests.ts` before AppServer can reference them.

### Task 1: Promote protocol schemas and clean up

**Files:** `packages/protocol/src/methods.ts`, `packages/protocol/src/client-requests.ts`, `packages/protocol/src/web-requests.ts` (DELETE), `packages/protocol/src/index.ts`

- Move all schemas from `web-requests.ts` into `client-requests.ts`. This includes `ModelInfoSchema` (already imported by `client-requests.ts`), `ConfigSetParams/Response`, `AuthListParams/Response`, `AuthSetParams/Response`, `AuthRemoveParams/Response`, `AuthOAuthStartParams/Response`, `ThreadSubscribeParams/Response`, `ThreadUnsubscribeParams/Response`, `ImageUploadParams/Response`.
- Add the 8 new method constants to `DILIGENT_CLIENT_REQUEST_METHODS` in `methods.ts`.
- Delete `DILIGENT_WEB_REQUEST_METHODS` from `methods.ts`.
- Update `DiligentClientRequestSchema` and `DiligentClientResponseSchema` discriminated unions to include the new methods.
- Update `index.ts` to stop re-exporting from `web-requests.ts`.
- Grep for remaining `DILIGENT_WEB_REQUEST_METHODS` and `web-requests` references — temporarily alias or update them.

**Verify:** `bun tsc --noEmit` across all packages passes with no references to deleted exports.

### Task 2: Multi-connection and subscription in AppServer

**Files:** `packages/core/src/app-server/server.ts`, `packages/core/src/rpc/server-binding.ts`

Replace the single `notificationListener` / `serverRequestHandler` pair with a connection registry. Each connected peer has its own `RpcPeer` reference and thread subscription set.

```typescript
interface ConnectedPeer {
  id: string;
  peer: RpcPeer;
  subscriptions: Set<string>;        // subscribed threadIds
  currentThreadId: string | null;    // most recently active thread (for default routing)
  cwd: string;
  mode: Mode;
  effort: ThinkingEffort;
}
```

Key changes:

**a) Remove `setNotificationListener` / `setServerRequestHandler`.** Replace with `connect()` / `disconnect()`:

```typescript
connect(connectionId: string, peer: RpcPeer, options?: { cwd?: string; mode?: Mode }): () => void
disconnect(connectionId: string): void
subscribeToThread(connectionId: string, threadId: string): string  // returns subscriptionId
unsubscribeFromThread(subscriptionId: string): boolean
```

**b) Change `handleRequest` signature** to accept connectionId:

```typescript
async handleRequest(connectionId: string, raw: unknown): Promise<JSONRPCResponse>
```

This flows through to `dispatchClientRequest(connectionId, request)`.

**c) Add session defaults injection** — `applySessionDefaults(connectionId, method, params)` called before dispatch. Update `currentThreadId` on the connection after `thread/start` and `thread/resume` succeed.

**d) Add turn initiator tracking** — `turnInitiators: Map<string, string>` (threadId → connectionId). Set on `turn/start`, cleared on `turn/completed` notification. Used by `emit()` to skip the initiator for `userMessage` item notifications.

**e) Rewrite `emit()`** to iterate connections with routing rules (see Key Design Decisions). Move `collab/` prefix debug logging from RpcBridge into the new `emit()`.

**f) Notification routing rules** (replaces RpcBridge.routeNotification):
- Notifications without `threadId` → broadcast to all connections.
- Notifications with `threadId` → send only to connections subscribed to that thread; if none subscribed, broadcast to all (fallback).
- `userMessage` item notifications → skip the connection that initiated the turn.

**g) Server request fan-out** (replaces RpcBridge.broadcastServerRequest):
- Send to all connections as JSON-RPC requests.
- First response wins; notify others with `server/request/resolved`.
- Timeout fallback (5 min): safe reject/empty.
- Track pending requests in `pendingServerRequests: Map<number, { resolve, sentTo }>`.

**h) Rewrite `bindAppServer`** as a thin wrapper:

```typescript
export function bindAppServer(server: DiligentAppServer, peer: RpcPeer): () => void {
  const id = crypto.randomUUID();
  return server.connect(id, peer);
}
```

`connect()` internally wires `peer.onMessage` for request dispatch and response handling, and returns a disconnect function that cleans up subscriptions and pending requests.

**Verify:** in-memory peer test — two peers connected, thread started, notifications routed only to the subscribed peer.

### Task 3: Promote thread/subscribe and thread/unsubscribe

**Files:** `packages/core/src/app-server/server.ts`

Add handling in `dispatchClientRequest`:

```typescript
case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_SUBSCRIBE: {
  const subscriptionId = this.subscribeToThread(connectionId, params.threadId);
  return { subscriptionId };
}
case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_UNSUBSCRIBE: {
  const ok = this.unsubscribeFromThread(params.subscriptionId);
  return { ok };
}
```

Update TUI `app.ts` and `runner.ts` to call `thread/subscribe` after `thread/start` or `thread/resume`. Remove the manual `threadId` filtering in `handleServerNotification` (AppServer now handles it).

**Important behavioral change for TUI:** Currently TUI receives ALL notifications. After this change, TUI must send `thread/subscribe` or it only receives threadId-less notifications plus fallback broadcasts (when zero subscribers exist for a thread). The fallback broadcast ensures no silent breakage during migration, but TUI should subscribe explicitly for correct behavior.

**Verify:** TUI receives notifications only for its active thread. Switching threads by resuming another stops notifications for the old one.

### Task 4: Absorb config/set and auth/* into AppServer

**Files:** `packages/core/src/app-server/server.ts`

Add to `DiligentAppServerConfig`:

```typescript
modelConfig?: {
  allModels: ModelInfo[];
  getAvailableModels: () => ModelInfo[];
  onModelChange: (modelId: string) => void;
};
providerManager?: ProviderManager;
openBrowser?: (url: string) => void;
```

Add to `dispatchClientRequest`:

```typescript
case DILIGENT_CLIENT_REQUEST_METHODS.CONFIG_SET: {
  // requires modelConfig; return -32601 if absent
  // validate model, call modelConfig.onModelChange
  // return { model }
}
case DILIGENT_CLIENT_REQUEST_METHODS.AUTH_LIST: {
  // requires providerManager + modelConfig; return -32601 if absent
  // loadAuthStore + loadOAuthTokens + buildProviderList
}
case DILIGENT_CLIENT_REQUEST_METHODS.AUTH_SET: {
  // requires providerManager; return -32601 if absent
}
case DILIGENT_CLIENT_REQUEST_METHODS.AUTH_REMOVE: {
  // requires providerManager; return -32601 if absent
}
case DILIGENT_CLIENT_REQUEST_METHODS.AUTH_OAUTH_START: {
  // requires providerManager + openBrowser; return -32601 if absent
  // PKCE flow, waitForCallback, emit account/updated notification
}
```

**OAuth state management:** Add `oauthPending: Promise<void> | null` as an AppServer instance field (migrated from RpcBridge). `auth/oauth/start` checks this before starting a new flow. The OAuth task runs as a detached async, sets `oauthPending = null` in its `finally` block. AppServer broadcasts `account/updated` and `account/login/completed` notifications to all connections after auth state changes.

`account/updated` and `account/login/completed` notifications are already defined in `DILIGENT_SERVER_NOTIFICATION_METHODS` — AppServer broadcasts them to all connections after auth state changes.

**Verify:** `auth/set` over an in-memory peer persists the key and triggers an `account/updated` broadcast to all connections.

### Task 5: Absorb image/upload into AppServer

**Files:** `packages/core/src/app-server/server.ts`

Add to `DiligentAppServerConfig`:

```typescript
toImageUrl?: (absPath: string) => string;  // web: /images/... URL, others: undefined
```

Add to `dispatchClientRequest`:

```typescript
case DILIGENT_CLIENT_REQUEST_METHODS.IMAGE_UPLOAD: {
  // resolve paths via config.resolvePaths
  // write base64 to .diligent/images/{threadId|drafts}/
  // return { attachment: { type: "local_image", path, mediaType, fileName, webUrl? } }
}
```

`webUrl` is present only when `config.toImageUrl` is provided. Web client uses it; TUI/Desktop ignore it.

**Verify:** image upload over in-memory peer writes a file to `.diligent/images/` and returns a valid attachment.

### Task 6: Simplify web server — delete RpcBridge

**Files:** `packages/web/src/server/index.ts`, `packages/web/src/server/rpc-bridge.ts` (DELETE)

Rewrite `index.ts` to pass `providerManager`, `openBrowser`, `modelConfig`, and `toImageUrl` via `DiligentAppServerConfig`. Wire WebSocket directly to AppServer via `appServer.connect()`:

```typescript
const appServer = new DiligentAppServer({
  // existing fields ...
  providerManager: runtimeConfig.providerManager,
  openBrowser: (url) => openBrowser(url),
  modelConfig: { allModels, getAvailableModels, onModelChange },
  toImageUrl: toWebImageUrl,
});

// In Bun.serve websocket handlers:
open(ws) {
  const peer = createWsPeer(ws);
  const disconnect = appServer.connect(ws.data.sessionId, peer);
  ws.data.disconnect = disconnect;
},
close(ws) {
  ws.data.disconnect?.();
},
async message(ws, raw) {
  // handled by peer's onMessage — no explicit dispatch needed
},
```

`createWsPeer(ws)` is a small helper (analogous to `createStdioPeer`) that wraps a Bun `ServerWebSocket` as an `RpcPeer`. It implements `send(msg)` (serialize to JSON and `ws.send`), `onMessage` callback (set by `connect()`), and `onClose` callback.

Delete `rpc-bridge.ts`. Delete or empty `ws-protocol.ts`.

**Verify:** browser initialize, thread/start, turn/start, auth/set, image/upload, reconnect all work without RpcBridge.

### Task 7: Update CLI — pass auth dependencies to AppServer

**Files:** `packages/cli/src/app-server-stdio.ts`

Pass `providerManager` to `DiligentAppServer` config so TUI can use `auth/list` and `auth/set` over RPC if needed in the future. `openBrowser` can be wired using the existing `openBrowser` import from core:

```typescript
return new DiligentAppServer({
  // existing ...
  providerManager: config.providerManager,
  openBrowser: (url) => openBrowser(url),
  modelConfig: {
    allModels: KNOWN_MODELS,
    getAvailableModels: () => /* filter by configured providers */,
    onModelChange: (id) => { config.model = resolveModel(id); },
  },
});
```

**Verify:** `auth/list` works over the stdio child in tests; existing CLI behavior unchanged.

### Task 8: Rewrite tests

**Files:** `packages/core/test/app-server.test.ts`, `packages/core/test/rpc-binding.test.ts`, `packages/web/test/rpc-bridge.test.ts` (REWRITE or DELETE), `packages/web/test/rpc-client.test.ts`, `packages/web/test/server.integration.test.ts`

- Core tests: cover multi-connection subscription routing, first-responder server requests, auth broadcast, session defaults injection, turn initiator skip logic.
- Web tests: `rpc-bridge.test.ts` either deleted or repurposed to test `createWsPeer` wiring only.
- Integration: browser-side initialize/subscribe/turn/auth/image over real WebSocket with no RpcBridge.
- TUI integration: verify thread/subscribe after thread/start, notifications stop for old thread after thread switch.

**Verify:** `bun test` passes across core, cli, web, protocol.

## Acceptance Criteria

1. `DILIGENT_WEB_REQUEST_METHODS` does not exist. All protocol methods live in `DILIGENT_CLIENT_REQUEST_METHODS`.
2. `RpcBridge` is deleted. `packages/web/src/server/` contains only `index.ts` and `tools.ts`.
3. TUI sends `thread/subscribe` after connecting and receives only its thread's notifications.
4. Web browser sends `thread/subscribe` explicitly; multi-tab routing works correctly.
5. `auth/set` over the CLI stdio child persists the key and triggers an `account/updated` notification.
6. `image/upload` over the Web WebSocket writes to `.diligent/images/` and returns a `webUrl`.
7. `DiligentAppServer` can be constructed with no `providerManager` / `openBrowser` / `modelConfig` — unsupported methods return `-32601`.
8. `bun test` passes across all packages. No `any` escape hatches in new code.
9. `dispatchClientRequest` receives `connectionId` — no connection-unaware request paths remain.
10. Session defaults injection (cwd, mode, threadId) works identically for TUI and Web connections.

## Risk Areas

| Risk | Mitigation |
|------|-----------|
| Notification routing regression — some notification reaches wrong tab | Port RpcBridge routing tests as AppServer multi-connection tests before deleting RpcBridge |
| First-responder semantics break — duplicate approval dialogs | Keep `pendingServerRequests` map and `server/request/resolved` logic, just move it into AppServer |
| OAuth flow is long-lived (minutes) — AppServer must not block other requests | Migrate `oauthPending` as AppServer instance field; OAuth runs as detached async task with `finally` cleanup |
| TUI subscription behavior regresses — threading logic now in AppServer not TUI | Zero-subscriber fallback broadcast prevents silent breakage; add TUI integration test that verifies subscribe + thread switch |
| `bindAppServer()` API change breaks external callers | Keep `bindAppServer(server, peer)` signature; it calls `server.connect()` internally |
| `handleRequest` signature change (added connectionId) breaks callers | Only internal callers exist (`connect()` wiring and `bindAppServer`); no external API surface |
| Session defaults diverge between TUI and Web | Single `applySessionDefaults()` in AppServer replaces both RpcBridge.withSessionDefaults and any TUI-side defaults |
| `collab/` notification debug logging lost in migration | Port the `collab/` prefix logging into AppServer's `emit()` method |
