---
id: P036
status: done
created: 2026-03-07
updated: 2026-03-07
---

# App-Server Transport Unification — CLI stdio Child + Raw JSON-RPC WebSocket

## Progress

### Done

- Task 1 core checkpoint landed.
  - Added `packages/core/src/rpc/channel.ts`, `framing.ts`, `client.ts`, `server-binding.ts`, and `index.ts`.
  - Added transport-neutral JSON-RPC binding and request-correlation helpers around `DiligentAppServer`.
  - Re-exported `bindAppServer` and RPC primitives from core/app-server entry points.
  - Added `packages/core/test/rpc-binding.test.ts` for in-memory peer binding, approval request roundtrip, and NDJSON framing coverage.
- Task 2 CLI stdio app-server checkpoint landed.
  - Added `packages/cli/src/app-server-stdio.ts` with `createCliAppServer()`, `createStdioPeer()`, `redirectConsoleToStderr()`, and `runAppServerStdio()`.
  - Updated `packages/cli/src/index.ts` to support `diligent app-server --stdio`.
  - Added `packages/cli/src/app-server-stdio.test.ts` and verified stdout stays protocol-only.
- Task 3 CLI child stdio RPC checkpoint landed.
  - `packages/cli/src/tui/rpc-client.ts` now implements a child-process stdio RPC client (`StdioAppServerRpcClient`) instead of the old in-process shortcut.
  - Added `packages/cli/src/tui/app-server-process.ts` and `rpc-framed-client.ts` for child spawn and stdio transport wiring.
  - `packages/cli/src/tui/app.ts` and `runner.ts` now use the spawned child app-server path.
  - Config reload now restarts the child RPC client so new runtime config is applied consistently.
  - Added `packages/cli/src/tui/__tests__/rpc-client.test.ts` for request framing and server-request fallback coverage.
- Task 4 Web raw JSON-RPC migration completed.
  - `packages/web/src/shared/ws-protocol.ts` shrunk to a single `ModelInfo` re-export — all custom wrapper discriminators removed.
  - `packages/web/src/server/rpc-bridge.ts` now parses and emits raw JSON-RPC messages; no more `rpc_request` / `server_notification` / `server_request` / `server_request_response` envelopes.
  - `packages/web/src/client/lib/rpc-client.ts` (`WebRpcClient`) speaks raw JSON-RPC over WebSocket and routes response vs. request vs. notification by JSON-RPC shape only.
  - Browser bootstrap data (cwd, mode, models) moved into the `initialize` result; `connected` wrapper eliminated.
  - Server-initiated approval/user-input flows as plain JSON-RPC requests; browser responds with plain JSON-RPC responses.
  - `server_request_resolved` replaced by `SERVER_REQUEST_RESOLVED` server notification (raw JSON-RPC notification) for cross-tab cleanup.
  - Reconnect/resubscribe now triggered deterministically after successful `initialize`.
  - Multi-subscriber routing, `turnInitiators`, and first-responder semantics all preserved in `RpcBridge`.
- Task 5 Protocol schemas aligned.
  - Initialize result carries `cwd`, `mode`, `currentModel`, `availableModels`, `capabilities`.
  - `SERVER_REQUEST_RESOLVED` promoted as an explicit server notification method.
- Task 6 Transport tests rewritten.
  - Core tests cover transport-neutral app-server binding.
  - CLI tests cover stdio child transport.
  - Web tests use raw JSON-RPC assertions.
- Task 7 Obsolete compatibility code removed and architecture documented.
  - `LocalAppServerRpcClient` fully removed; no source reference remains.
  - Old WS wrapper discriminators (`rpc_request`, `server_notification`, `server_request_response`) eliminated from all production source files.
  - `ARCHITECTURE.md` updated to reflect stdio child CLI path and raw JSON-RPC WebSocket transport.

### Deferred / Out of Scope

- A separately packaged/invocable app-server binary is intentionally deferred. Current direction remains a real process boundary via `diligent app-server --stdio`; packaging separation can be evaluated later as a follow-up decision if needed.

## Goal

Make `DiligentAppServer` the single real runtime boundary for all clients. After this plan lands, interactive TUI and non-interactive CLI will talk to a spawned app-server child over stdio JSON-RPC, and Web will use raw JSON-RPC over WebSocket instead of the current wrapper envelopes.

## Prerequisites

- `packages/core/src/app-server/server.ts` already implements the shared request/notification contract through `DiligentAppServer`.
- `packages/cli/src/tui/rpc-client.ts` already centralizes CLI RPC semantics, even though it is currently in-process.
- `packages/web/src/server/rpc-bridge.ts` already handles server-initiated request fan-out and thread subscription routing.
- `packages/protocol` already defines shared JSON-RPC schemas plus Diligent client/server request and notification schemas.

## Artifact

A contributor can run either client and know both are speaking the same real protocol boundary:

```text
User → launches diligent TUI
CLI → spawns `diligent app-server --stdio`
TUI → sends JSON-RPC initialize/thread/start/turn/start over stdio
App server → emits raw JSON-RPC notifications and server requests
Agent → responds in TUI

User → opens Web app
Browser → opens /rpc WebSocket and sends raw JSON-RPC initialize/thread/start/turn/start
App server → emits raw JSON-RPC notifications and server requests over WS
Agent → responds in Web
```

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| `packages/core/src/app-server` | Add transport-neutral message binding/helpers around `DiligentAppServer` and standardize server-initiated request handling over raw JSON-RPC messages. |
| `packages/core/src/rpc` | New shared transport utilities for framing, request correlation, and binding a message stream to app-server semantics. |
| `packages/cli/src/index.ts` | Add app-server child mode (`app-server --stdio`) and process-mode branching. |
| `packages/cli/src/tui` | Replace `LocalAppServerRpcClient` with a spawned-child stdio RPC client for interactive TUI and non-interactive runner. |
| `packages/web/src/server` | Replace custom WS wrapper envelopes with raw JSON-RPC handling while preserving Web-specific multi-subscriber routing behavior. |
| `packages/web/src/client/lib` | Refactor browser RPC client to send/receive raw JSON-RPC messages and treat server-initiated requests as normal JSON-RPC requests. |
| `packages/protocol/src` | Adjust schemas only where shared protocol semantics need promotion (for example, if `server_request_resolved` becomes a real notification or initialize payloads expand). |
| `packages/*/test` | Rewrite transport tests to reflect stdio child transport in CLI and raw JSON-RPC over WS in Web. |

### What does NOT change

- No model/provider behavior changes.
- No agent-loop, compaction, or tool semantics changes beyond transport plumbing.
- No Desktop-specific UX work in this plan; desktop inherits Web server changes as needed but is not a primary migration surface.
- No remote daemon, TCP socket server, or multi-machine transport support.
- No attempt to preserve the in-process CLI path as a long-term fallback once the migration is complete.

## Architecture Summary

### Current architecture

```text
CLI/TUI
  └─ LocalAppServerRpcClient
      └─ direct method calls into DiligentAppServer (same process)

Web
  └─ WebRpcClient
      └─ custom WS envelopes (rpc_request/server_notification/server_request/...)
          └─ RpcBridge
              └─ DiligentAppServer
```

### Target architecture

```text
CLI/TUI
  └─ StdioRpcClient
      └─ child process: diligent app-server --stdio
          └─ DiligentAppServer

Web
  └─ WebRpcClient
      └─ raw JSON-RPC over WebSocket
          └─ RpcBridge (routing only, no custom RPC envelope)
              └─ DiligentAppServer
```

### Core design rules

1. `DiligentAppServer` remains the single source of truth for client/server protocol behavior.
2. `packages/core` owns transport-neutral RPC binding helpers, not WebSocket-specific or browser-specific details.
3. Server-initiated approval and user-input flows become plain JSON-RPC requests from server to client.
4. When app-server runs over stdio, stdout is reserved for machine-readable protocol frames and stderr is reserved for logs.

## File Manifest

### `packages/core/src/app-server/`

| File | Action | Description |
|------|--------|------------|
| `server.ts` | MODIFY | Expose transport-neutral hooks for server notifications and server-initiated requests without assuming in-memory callback wiring only. |
| `index.ts` | MODIFY | Re-export new app-server transport helpers. |

### `packages/core/src/rpc/`

| File | Action | Description |
|------|--------|------------|
| `channel.ts` | CREATE | Small transport-neutral interface for sending/receiving JSON-RPC messages. |
| `framing.ts` | CREATE | NDJSON framing helpers for stdio streams. |
| `server-binding.ts` | CREATE | Bind an incoming message stream to `DiligentAppServer` and emit responses/notifications/requests. |
| `client.ts` | CREATE | Shared request-correlation and server-request handling logic reusable by CLI and possibly Web. |
| `index.ts` | CREATE | Re-export RPC transport primitives. |

### `packages/core/test/`

| File | Action | Description |
|------|--------|------------|
| `app-server.test.ts` | MODIFY | Cover transport-neutral behavior and server-initiated request correlation assumptions. |
| `rpc-binding.test.ts` | CREATE | Validate message binding, raw JSON-RPC flow, and stdio framing helpers. |

### `packages/cli/src/`

| File | Action | Description |
|------|--------|------------|
| `index.ts` | MODIFY | Add `app-server --stdio` mode and preserve regular CLI entry behavior. |
| `app-server-stdio.ts` | CREATE | Build runtime config and run app-server over stdio. |

### `packages/cli/src/tui/`

| File | Action | Description |
|------|--------|------------|
| `app.ts` | MODIFIED (checkpoint landed) | Replaced in-process app server creation with spawned child stdio client. |
| `runner.ts` | MODIFIED (checkpoint landed) | Uses spawned child stdio RPC client in non-interactive mode. |
| `rpc-client.ts` | REPLACED (checkpoint landed) | Child-process stdio RPC client with request correlation and server-request handling. |
| `app-server-process.ts` | CREATED (checkpoint landed) | Spawns, monitors, and terminates the child app-server process. |
| `rpc-framed-client.ts` | CREATED (checkpoint landed) | CLI-specific stdio framing and child-process adapter over app-server stdio. |

### `packages/cli/src/tui/__tests__/`

| File | Action | Description |
|------|--------|------------|
| `rpc-client.test.ts` | CREATED (checkpoint landed) | Tests stdio request/response framing and default server-request responses. |
| `runner.test.ts` | MODIFY | Verify non-interactive runner still behaves correctly via child RPC. |
| `app.integration.test.ts` | MODIFY | Adapt TUI integration expectations to child-process-backed RPC. |

### `packages/web/src/shared/`

| File | Action | Description |
|------|--------|------------|
| `ws-protocol.ts` | MODIFY | Remove custom RPC wrapper message types or shrink the file to Web-only non-RPC data if anything remains. |

### `packages/web/src/server/`

| File | Action | Description |
|------|--------|------------|
| `rpc-bridge.ts` | MODIFY | Parse and emit raw JSON-RPC messages, route subscriber-specific notifications, and handle server-initiated request fan-out as JSON-RPC. |
| `index.ts` | MODIFY | Keep `/rpc` WebSocket upgrade logic while simplifying transport assumptions. |

### `packages/web/src/client/lib/`

| File | Action | Description |
|------|--------|------------|
| `rpc-client.ts` | MODIFY | Speak raw JSON-RPC over WebSocket and treat server-originated requests as normal JSON-RPC requests. |
| `use-server-requests.ts` | MODIFY | Ensure server-request handling matches the new raw JSON-RPC flow. |

### `packages/web/test/`

| File | Action | Description |
|------|--------|------------|
| `rpc-client.test.ts` | MODIFY | Replace wrapper-envelope assumptions with raw JSON-RPC message assertions. |
| `rpc-bridge.test.ts` | MODIFY | Validate raw JSON-RPC routing, multi-subscriber behavior, and first-responder semantics. |
| `server.integration.test.ts` | MODIFY | Exercise real `/rpc` handling with raw JSON-RPC. |

### `packages/protocol/src/`

| File | Action | Description |
|------|--------|------------|
| `jsonrpc.ts` | MODIFY | Expand shared message typing if needed for server-initiated request use. |
| `client-requests.ts` | MODIFY | Update initialize payload/result if bootstrap data moves here. |
| `server-notifications.ts` | MODIFY | Add any promoted notifications required by the raw JSON-RPC transport. |
| `methods.ts` | MODIFY | Register any newly promoted protocol methods. |

### `packages/protocol/test/`

| File | Action | Description |
|------|--------|------------|
| `protocol-jsonrpc.test.ts` | MODIFY | Cover server-initiated request and response shapes if they expand. |
| `protocol-flow.test.ts` | MODIFY | Cover initialize/bootstrap and any promoted transport-level notifications. |

## Implementation Tasks

### Task 1: Introduce transport-neutral RPC primitives in core

**Files:** `packages/core/src/rpc/channel.ts`, `packages/core/src/rpc/framing.ts`, `packages/core/src/rpc/server-binding.ts`, `packages/core/src/rpc/client.ts`, `packages/core/src/rpc/index.ts`, `packages/core/src/app-server/index.ts`

Create a minimal shared RPC layer that understands raw JSON-RPC messages and request correlation without knowing anything about Bun WebSockets or spawned child processes.

```typescript
import type {
  JSONRPCMessage,
  JSONRPCNotification,
  JSONRPCRequest,
  JSONRPCResponse,
  DiligentServerNotification,
  DiligentServerRequest,
  DiligentServerRequestResponse,
} from "@diligent/protocol";

export interface RpcMessageSink {
  send(message: JSONRPCMessage): Promise<void> | void;
}

export interface RpcMessageSource {
  onMessage(listener: (message: JSONRPCMessage) => void | Promise<void>): void;
  onClose?(listener: (error?: Error) => void): void;
}

export interface RpcPeer extends RpcMessageSink, RpcMessageSource {}

export function bindAppServer(server: DiligentAppServer, peer: RpcPeer): () => void {
  // wires requests, notifications, server notifications, and server-initiated requests
}

export function createNdjsonParser(onMessage: (message: JSONRPCMessage) => void): {
  push(chunk: string): void;
  end(): void;
} {
  // line-buffered framing for stdio
}
```

Key requirements:
- distinguish request vs notification vs response using JSON-RPC schemas only
- allow the server to issue approval/user-input requests as outbound JSON-RPC requests
- support correlation for responses to server-originated requests
- keep all log output outside this layer

**Verify:** core tests can bind a fake in-memory peer to `DiligentAppServer` and complete initialize/thread/start/turn/start plus approval/user-input roundtrips using raw JSON-RPC messages only.

### Task 2: Add CLI app-server stdio mode

**Files:** `packages/cli/src/index.ts`, `packages/cli/src/app-server-stdio.ts`

Add a first-class CLI mode that launches only the app server over stdio. This mode must be suitable for use as a child process from the TUI and non-interactive runner.

```typescript
export interface AppServerStdioOptions {
  cwd: string;
  yolo?: boolean;
}

export async function runAppServerStdio(options: AppServerStdioOptions): Promise<never> {
  const appServer = await createCliAppServer(options);
  const stop = bindAppServer(appServer, createStdioPeer(process.stdin, process.stdout));
  process.stdin.on("end", () => {
    stop();
    process.exit(0);
  });
  return await new Promise<never>(() => {});
}
```

Important constraints:
- `stdout` is protocol-only
- diagnostics go to `stderr`
- EOF or parent disconnect should terminate the child cleanly
- CLI flags and cwd resolution must match normal CLI behavior closely enough that the child sees the same project/runtime configuration

**Verify:** `bun run packages/cli/src/index.ts app-server --stdio` accepts an initialize request on stdin and returns a valid JSON-RPC response on stdout without any stray logging.

### Task 3: Replace in-process CLI RPC with child stdio RPC

**Files:** `packages/cli/src/tui/rpc-client.ts`, `packages/cli/src/tui/app-server-process.ts`, `packages/cli/src/tui/rpc-framed-client.ts`, `packages/cli/src/tui/app.ts`, `packages/cli/src/tui/runner.ts`

Remove `LocalAppServerRpcClient` as the default path and replace it with a child-process-backed client. Interactive TUI and non-interactive runner should share the same child RPC foundation.

```typescript
export interface SpawnedAppServer {
  request<M extends DiligentClientRequest["method"]>(
    method: M,
    params: Extract<DiligentClientRequest, { method: M }>["params"],
  ): Promise<Extract<DiligentClientResponse, { method: M }> ["result"]>;
  notify(method: string, params?: unknown): Promise<void>;
  setNotificationListener(listener: ((notification: DiligentServerNotification) => void | Promise<void>) | null): void;
  setServerRequestHandler(
    handler: ((request: DiligentServerRequest) => Promise<DiligentServerRequestResponse>) | null,
  ): void;
  dispose(): Promise<void>;
}

export async function spawnCliAppServer(cwd: string): Promise<SpawnedAppServer> {
  // spawn diligent app-server --stdio and attach framing client
}
```

Requirements:
- preserve current TUI behaviors for interrupt, steering, approvals, and request-user-input
- capture child exit/failure and surface a clear fatal error to the user
- ensure TUI shutdown cleans up the child process
- ensure non-interactive mode does not hang on child stderr output or pending turn cleanup

**Verify:** interactive app startup, thread start/resume, turn interrupt, and non-interactive `--prompt` mode all work through the child process with no direct `new DiligentAppServer()` in TUI paths.

### Task 4: Convert Web to raw JSON-RPC over WebSocket

**Files:** `packages/web/src/shared/ws-protocol.ts`, `packages/web/src/server/rpc-bridge.ts`, `packages/web/src/server/index.ts`, `packages/web/src/client/lib/rpc-client.ts`, `packages/web/src/client/lib/use-server-requests.ts`

Remove custom WS wrapper messages and make both browser and server exchange raw JSON-RPC messages directly. Keep only Web-specific connection and subscription logic that cannot live in raw JSON-RPC itself.

```typescript
import type { JSONRPCMessage, JSONRPCRequest, JSONRPCResponse, JSONRPCNotification } from "@diligent/protocol";

export class WebRpcClient {
  private pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;

  async request(method: string, params: unknown): Promise<unknown> {
    const message: JSONRPCRequest = { id: this.nextRequestId++, method, params };
    this.ws?.send(JSON.stringify(message));
    return await this.awaitResponse(message.id);
  }

  notify(method: string, params?: unknown): void {
    const message: JSONRPCNotification = { method, params };
    this.ws?.send(JSON.stringify(message));
  }

  private handleMessage(raw: unknown): void {
    const message = JSONRPCMessageSchema.parse(JSON.parse(String(raw)));
    // route response vs notification vs server-originated request
  }
}
```

Key decisions to land here:
- browser bootstrap data should move out of the custom `connected` wrapper and into shared JSON-RPC flows, most likely `initialize`
- server-originated approval/user-input requests become ordinary JSON-RPC requests to the browser
- any current Web-only synthetic messages that still matter should be promoted to explicit protocol methods/notifications or eliminated

#### Task 4 implementation guide for the next agent

Start from the current wrapper boundaries:

- `packages/web/src/shared/ws-protocol.ts`
  - currently defines wrapper discriminators like `connected`, `rpc_request`, `rpc_response`, `server_notification`, `server_request`, `server_request_response`, and `server_request_resolved`
- `packages/web/src/server/rpc-bridge.ts`
  - currently parses wrapper messages in `message()` and emits wrapper messages from `open()`, `routeNotification()`, and `broadcastServerRequest()`
- `packages/web/src/client/lib/rpc-client.ts`
  - currently assumes wrapper messages in `request()`, `notify()`, `respondServerRequest()`, and `handleMessage()`
- `packages/web/src/client/App.tsx`
  - currently depends on `rpc.onConnected(...)` receiving bootstrap metadata from the synthetic `connected` message before it sends `initialize`
- `packages/web/src/client/lib/use-server-requests.ts`
  - currently expects a numeric request id and explicit `server_request_resolved` cleanup notifications

Recommended migration order:

1. **Promote bootstrap data into `initialize` before changing the wire format.**
   - Today `App.tsx` depends on `connected` metadata for `cwd`, `mode`, `effort`, `currentModel`, and `availableModels`.
   - Do not remove `connected` first and then figure this out later.
   - Expand the shared initialize result so Web can get everything it currently receives from `connected`.
   - Then update `App.tsx` / `WebRpcClient` to treat `initialize` as the source of bootstrap metadata.

2. **Keep Web-only methods, but send them as raw JSON-RPC requests.**
   - `config/set`, `auth/list`, `auth/set`, `auth/remove`, `auth/oauth/start`, `thread/subscribe`, `thread/unsubscribe`, and `image/upload` can remain Web-only methods for now.
   - The migration goal is the wire format, not necessarily eliminating every Web-only method in the same checkpoint.
   - `rpc-bridge.ts` should still special-case these methods, but receive them as ordinary JSON-RPC requests instead of `{ type: "rpc_request", ... }` wrappers.

3. **Convert server notifications to plain JSON-RPC notifications.**
   - Replace `{ type: "server_notification", notification }` with the notification object itself.
   - `routeNotification()` in `rpc-bridge.ts` should send raw `DiligentServerNotification` values directly.
   - `WebRpcClient.handleMessage()` should treat `method` without `id` as a notification.

4. **Convert server-originated approval/user-input to plain JSON-RPC requests.**
   - Replace `{ type: "server_request", id, request }` with `{ id, method, params }`.
   - Replace `{ type: "server_request_response", id, response }` with a normal JSON-RPC response carrying `result`.
   - Prefer removing `server_request_resolved` entirely if normal JSON-RPC request/response handling makes it redundant.
   - If the browser still needs explicit cleanup for buffered prompts resolved in another tab, promote that to an explicit protocol notification rather than keeping a WS-only wrapper discriminator.

5. **Preserve multi-subscriber semantics in `RpcBridge`; do not simplify them away.**
   - Current bridge behavior that must survive the migration:
     - `threadSubscribers` routing
     - `subscriptions` bookkeeping
     - `turnInitiators` routing
     - first-responder wins for approval/user-input
     - safe fallback when no clients are connected
   - Task 4 is a wire-format migration, not a behavior rewrite.

6. **Do not break reconnect logic while changing bootstrap.**
   - `WebRpcClient` currently calls `resubscribeAll()` when it receives `connected`.
   - After removing `connected`, resubscribe after the socket opens and/or after a successful `initialize`, but do it deterministically in one place.
   - `App.tsx` currently does reconnect bootstrap in `rpc.onConnected(...)`; that orchestration will need to move to either:
     - an initialize result callback from `WebRpcClient`, or
     - explicit `await rpc.initialize()` flow in the app layer.

Recommended concrete code changes:

- `packages/web/src/shared/ws-protocol.ts`
  - shrink or delete the wrapper unions
  - if any non-RPC-only WebSocket payload remains, document exactly why it is not a protocol method
- `packages/web/src/client/lib/rpc-client.ts`
  - parse raw `JSONRPCMessageSchema`
  - classify response vs request vs notification by JSON-RPC shape only
  - keep request correlation map
  - keep reconnect policy
  - likely replace `onConnected(...)` with either:
    - `initialize()` returning bootstrap metadata, or
    - a listener fed by initialize result rather than raw socket open
- `packages/web/src/server/rpc-bridge.ts`
  - parse raw JSON objects as JSON-RPC requests / notifications / responses
  - keep the current special handling for Web-only methods, but emit normal JSON-RPC responses
  - convert notification fan-out and server-request fan-out to raw JSON-RPC messages
- `packages/web/src/client/App.tsx`
  - move all bootstrap currently triggered by `connected` to an initialize-driven flow
  - keep reconnect resume logic intact after the bootstrap source changes
- `packages/web/src/client/lib/use-server-requests.ts`
  - make sure prompt buffering/cleanup still works if `server_request_resolved` disappears
  - if another-tab resolution still needs server-side notification, do not reintroduce a WS wrapper; use a real protocol notification

Known traps from the current code:

- `App.tsx` currently calls `providerMgr.setInitialModel(meta.currentModel ?? "", meta.availableModels)` inside `rpc.onConnected(...)`. If initialize result is not expanded first, provider/model state will regress.
- `WebRpcClient.resubscribeAll()` currently depends on receipt of `connected`. Reconnect behavior will silently regress if that call is not relocated.
- `RpcBridge.open()` currently sends bootstrap immediately on socket open. Once removed, the browser must not assume state is ready before initialize resolves.
- `use-server-requests.ts` currently tracks buffered cross-thread prompts and listens for `handleServerRequestResolved()`. Decide that replacement before deleting the old signal.
- `rpc-bridge.test.ts` and `server.integration.test.ts` are heavily wrapper-oriented today; rewrite them as raw JSON-RPC tests instead of mechanically renaming fields.

Suggested acceptance slice for the next agent:

1. initialize returns bootstrap metadata needed by Web
2. raw JSON-RPC request/response works for initialize/thread/start/turn/start
3. raw JSON-RPC notifications fan out correctly
4. approval/user-input round-trip as raw JSON-RPC requests/responses
5. reconnect + resubscribe still works
6. multi-subscriber first-responder semantics still pass

**Verify:** browser `initialize`, `thread/start`, `turn/start`, approval, user-input, reconnect, and multi-subscriber routing all work with raw JSON-RPC over `/rpc`.

### Task 5: Reconcile protocol schemas and bootstrap semantics

**Files:** `packages/protocol/src/jsonrpc.ts`, `packages/protocol/src/client-requests.ts`, `packages/protocol/src/server-notifications.ts`, `packages/protocol/src/methods.ts`, related tests

Promote any transport behavior that is currently encoded only in Web wrappers into first-class protocol schemas. Keep `@diligent/protocol` limited to shapes, not transport logic.

```typescript
export const InitializeResultSchema = z.object({
  serverName: z.string(),
  serverVersion: z.string(),
  protocolVersion: z.number().int(),
  capabilities: z.object({
    supportsFollowUp: z.boolean(),
    supportsApprovals: z.boolean(),
    supportsUserInput: z.boolean(),
  }),
  cwd: z.string().optional(),
  mode: z.enum(["default", "plan", "execute"]).optional(),
  currentModel: z.string().optional(),
  availableModels: z.array(ModelInfoSchema).optional(),
});
```

Only promote fields that truly belong to the shared client/server contract. If some Web-only state should remain Web-specific, keep it outside protocol and document why.

**Verify:** both CLI and Web can initialize successfully using only raw JSON-RPC message types and shared protocol schemas.

### Task 6: Rewrite transport tests and land end-to-end regression coverage

**Files:** `packages/core/test/app-server.test.ts`, `packages/core/test/rpc-binding.test.ts`, `packages/cli/src/tui/__tests__/*`, `packages/web/test/*`, `packages/e2e/*`

Once transports are unified, rewrite tests around the new reality:
- core tests validate transport-neutral app-server semantics
- CLI tests validate stdio child transport
- Web tests validate raw JSON-RPC over WS
- e2e smoke tests validate real transport paths, not in-process shortcuts

```typescript
test("approval request round-trips over stdio child RPC", async () => {
  const client = await spawnCliAppServer(testCwd);
  client.setServerRequestHandler(async (request) => {
    if (request.method === "approval/request") {
      return { method: "approval/request", result: { decision: "once" } };
    }
    return { method: "user_input/request", result: { answers: {} } };
  });
  // run initialize + thread/start + turn/start and assert completion
});
```

Coverage priorities:
1. initialize/start/turn over stdio
2. approval and user-input server requests over stdio and WS
3. interrupt/abort over stdio and WS
4. Web multi-subscriber and first-responder semantics after removing wrapper messages
5. opt-in live smoke over real transport when provider env vars are present

**Verify:** targeted CLI, Web, core, and e2e suites pass with no remaining test paths depending on the removed in-process CLI shortcut.

### Task 7: Remove obsolete compatibility code and document the new architecture

**Files:** stale wrapper types, legacy rpc client files, docs, AGENTS-facing references if needed

After the new path is stable, delete the in-process local RPC client and now-dead Web wrapper message shapes. Update developer-facing docs so future work does not reintroduce split transport assumptions.

```typescript
// delete
export class LocalAppServerRpcClient {
  // legacy in-process shortcut
}
```

Cleanup requirements:
- remove dead code only after tests are green on the new path
- update architecture docs to describe the stdio child CLI path and raw JSON-RPC WebSocket path
- ensure no package still imports removed wrapper message types

**Verify:** repository grep shows no remaining references to `LocalAppServerRpcClient` or old WS wrapper message discriminators such as `rpc_request` / `server_notification`.

## Acceptance Criteria

1. Interactive TUI no longer constructs or calls `DiligentAppServer` directly; it communicates with a spawned child app-server over stdio JSON-RPC.
2. Non-interactive CLI no longer constructs or calls `DiligentAppServer` directly; it uses the same child stdio RPC path.
3. Web `/rpc` uses raw JSON-RPC requests, responses, and notifications instead of the current custom wrapper envelopes.
4. Approval and user-input flows round-trip as server-initiated JSON-RPC requests in both CLI and Web.
5. Child stdio app-server mode emits no non-protocol data on stdout.
6. Existing thread lifecycle and item streaming behavior still work in both clients after migration.
7. Targeted core, CLI, Web, and e2e test suites pass.
8. No new code uses `any` as an escape hatch for transport message handling.

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | NDJSON framing, request correlation, message classification | `bun test` for new core rpc helpers |
| Integration | `DiligentAppServer` bound to in-memory peer | Core transport-binding tests |
| Integration | CLI child stdio initialize/start/turn/interrupt | CLI transport tests using spawned child process |
| Integration | Web raw JSON-RPC request/notification/server-request flow | Web bridge and rpc-client tests |
| End-to-end | Real `/rpc` WS smoke | Bun server + browser WebSocket test |
| End-to-end | CLI stdio smoke | spawn CLI app-server and drive raw JSON-RPC over stdio |
| Manual | Interactive TUI approval, interrupt, and resume behavior | Run `diligent`, inspect normal chat lifecycle |
| Manual | Browser reconnect and multi-tab server-request behavior | Run Web app locally and exercise approval/user-input across tabs |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Stray stdout logging in stdio app-server mode corrupts RPC frames | Child CLI transport becomes unusable and flaky | Route all diagnostics to stderr, add tests that parse entire stdout as protocol frames only |
| Child process lifecycle bugs leave zombie app-server processes | Broken UX, leaked processes, hard-to-reproduce shutdown bugs | Add explicit dispose/EOF/exit handling and tests for parent shutdown + child crash |
| Web reconnect semantics regress when wrapper protocol is removed | Reconnect, re-subscribe, or pending request handling may break | Preserve request-correlation map and re-subscribe logic while only swapping the wire format |
| Approval/user-input first-responder behavior regresses across browser tabs | Users may see duplicate dialogs or lost decisions | Keep server-side pending request bookkeeping in `RpcBridge`, rewrite tests before cleanup |
| Initialize/bootstrap data becomes ambiguous when removing `connected` wrapper | Web client may not know cwd/model/capabilities at startup | Decide and document the initialize payload before implementation, then encode it in protocol tests |
| Migration blast radius is large across core/cli/web/protocol | Long-lived branch, partial breakage, difficult review | Land in small checkpoints matching Tasks 1–7 with passing tests after each checkpoint |
| TUI stderr interaction with child logs degrades terminal rendering | Debug output can corrupt user-visible terminal state | Keep child stderr out of the render surface in normal operation and only surface fatal startup errors intentionally |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| N/A | This plan defines a migration program but does not depend on a separately recorded decision doc yet. | Entire plan |
