# @diligent/web

React + Tailwind web frontend. Thin client over WebSocket JSON-RPC — same protocol as the CLI.

## Structure

```
src/
  server/
    index.ts      Bun HTTP/WebSocket server: start DiligentAppServer from @diligent/runtime, expose /rpc, serve static files
  client/
    components/   React UI components (see below)
    lib/          RPC bridge, WebSocket client, state (see below)
    styles/       Tailwind CSS entrypoint and design tokens
  shared/         Types shared between server and client
```

## Transport

The web server starts `DiligentAppServer` in-process and exposes a WebSocket endpoint at `/rpc`. Each connection is wired via `appServer.connect()`. The React client connects via `RpcBridge` — same raw JSON-RPC 2.0 messages as the CLI stdio transport, no custom envelope.

`@diligent/web` depends on two shared backend packages:

- `@diligent/core` for reusable engine types
- `@diligent/runtime` for Diligent's app-server, sessions, tools, and RPC runtime

## client/components

| Component | Purpose |
|---|---|
| `ApprovalCard` | Inline approval card (once / always / reject) |
| `AssistantMessage` | Assistant bubble with thinking block and markdown |
| `InputDock` | Auto-resize textarea, send/stop controls, status tray |
| `MessageList` | Scrollable feed with auto-scroll and scroll-to-bottom button |
| `ToolBlock` | Tool call with icon, summary, and expandable content |
| `ThinkingBlock` | Collapsible thinking block — streams live, collapses when done |
| `Sidebar` | Thread list, new thread button, relative timestamps |
| `PlanPanel` | Persistent plan progress panel |
| `ProviderSettingsModal` | API key management and ChatGPT OAuth |
| `QuestionCard` | Agent-initiated user input prompt |
| `StreamBlock` | Renders user, assistant (markdown), and thinking stream blocks |

## client/lib

| File | Purpose |
|---|---|
| `rpc-client.ts` | WebSocket JSON-RPC client |
| `thread-store.ts` | Protocol event reducer and thread view-state |
| `use-rpc.ts` | WebRpcClient lifecycle: creation, connection, reconnect |
| `use-server-requests.ts` | Server-driven approval and user-input prompt state |
| `use-provider-manager.ts` | Provider auth state, available models, OAuth hooks |
| `tool-info.ts` | Tool display name, icon, category, input summarizer |
| `markdown.ts` | marked wrapper for rendering agent output as HTML |

## Dev

```bash
bun run dev       # Vite dev server + HMR
bun run build     # Production build
```
