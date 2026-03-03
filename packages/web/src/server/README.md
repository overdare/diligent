# Web Server

Bun server and app-server bridge for Web CLI.

This directory contains the runtime server layer for the Web frontend. It starts a Bun HTTP/WebSocket server that serves the built React app as static files and exposes a `/rpc` WebSocket endpoint for the browser client. All agent communication travels through `RpcBridge`, which multiplexes JSON-RPC calls, push notifications, and server-initiated requests (e.g. auth flows) over a single persistent WebSocket connection.

## Files

- `index.ts` — Bun server entrypoint; registers the `/rpc` WebSocket route, resolves config/model, and wires `RpcBridge` + `DiligentAppServer` together
- `rpc-bridge.ts` — WebSocket bridge that multiplexes JSON-RPC calls, notifications, and server requests between the browser and the core `DiligentAppServer`
- `tools.ts` — Built-in Web CLI tool assembly; re-exports `buildDefaultTools` from `@diligent/core`
