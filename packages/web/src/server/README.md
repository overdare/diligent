# Web Server

Bun server and app-server bridge for Web CLI.

This directory contains the runtime server layer for the Web frontend. It starts a Bun HTTP/WebSocket server that serves the built React app as static files and exposes a `/rpc` WebSocket endpoint for the browser client. Each WebSocket connection is wired directly to `DiligentAppServer` via `appServer.connect()`, which handles all JSON-RPC routing, push notifications, and server-initiated requests.

## Files

- `index.ts` — Bun server entrypoint; registers the `/rpc` WebSocket route, a persisted-image HTTP route, resolves config/model, and wires WebSocket connections to `DiligentAppServer`
- `tools.ts` — Built-in Web CLI tool assembly; re-exports `buildDefaultTools` from `@diligent/core`
