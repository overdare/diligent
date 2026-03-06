# Client Lib

Client-side utilities, networking, and state management.

```
lib/
  cn.ts                    Tailwind class merge utility
  format-time.ts           Relative time formatter (just now, 2m ago, yesterday, Jan 5)
  markdown.ts              marked wrapper for rendering agent output as HTML
  rpc-client.ts            WebSocket JSON-RPC client
  thread-store.ts          Protocol event reducer and thread view-state
  tool-info.ts             Tool display name, icon, category, and input summarizer
  use-provider-manager.ts  Provider auth state, available models, and OAuth hooks
  use-rpc.ts               WebRpcClient lifecycle: creation, connection state, reconnect
  use-server-requests.ts   Server-driven approval and user-input prompt state
```

Shared route helpers for persisted image URLs live in `../shared/image-routes.ts`.
