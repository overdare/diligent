# @diligent/protocol

Shared API contract. All JSON-RPC message schemas and domain models, validated with Zod.

## What's defined here

- **20 client request methods** — initialize, thread/start, thread/resume, thread/list, thread/read, thread/delete, thread/subscribe, thread/unsubscribe, turn/start, turn/interrupt, turn/steer, mode/set, effort/set, knowledge/list, config/set, auth/list, auth/set, auth/remove, auth/oauth/start, image/upload
- **26 server notification types** — thread/turn/item lifecycle, status, usage, errors, knowledge, loop detection, collab events, steering, account, etc.
- **2 server request types** — approval/request, userInput/request (server-initiated callbacks)
- **Domain models** — Message, AgentEvent, ThreadItem, SessionSummary, ProviderAuthStatus

Both CLI stdio and Web WebSocket transports use these schemas with no custom wrapper envelope.
