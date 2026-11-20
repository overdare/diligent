# 03 — MCP client capabilities: elicitation, roots, sampling, tool list changes

Status: proposal · Depends on: none · Integrates with: 06 (worktree roots), 10 (denials)

## Problem

Diligent connects to MCP servers as a client that advertises no capabilities. Servers that ask the user a question
mid-call (elicitation), need to know the workspace (roots), or delegate a model call (sampling) either fail or
degrade. Tool list changes are never picked up until reconnect.

## Current state

| Fact | Evidence |
|---|---|
| Both connect paths construct `new Client({name:"diligent", …}, { capabilities: {} })` | `packages/runtime/src/tools/mcp/client.ts:295, 517` |
| No request handlers for `elicitation/create`, `roots/list`, `sampling/createMessage`; no `tools/list_changed` handling | grep of `tools/mcp/` for `setRequestHandler`, `list_changed`, `elicit` returns nothing |
| One process-wide `McpConnectionManager` singleton shared by every thread and cwd | `client.ts:170, 644-646` |
| Installed SDK 1.29.0 exports `ElicitRequestSchema`, `ElicitationCompleteNotificationSchema`, `UrlElicitationRequiredError`, `ListRootsRequestSchema`, `RootsListChangedNotificationSchema`, `CreateMessageRequestSchema`, `ToolListChangedNotificationSchema` | `@modelcontextprotocol/sdk@1.29.0` `dist/esm/types.d.ts` |
| The only server→client interaction requests are `approval/request` and `userInput/request` | `packages/protocol/src/methods.ts:94-97` |
| `userInput/request` questions require `options.min(1)` — no free-text, number, or boolean fields | `protocol/src/data-model.ts:519-528` |
| User-input prompts are already serialized per thread and pause goals when no client is connected | `app-server/server.ts:205-208, 676-688` |

## Reference survey

- **codex** `rmcp-client/src/elicitation_client_service.rs:149-205`: elicitation is forwarded through a
  `send_elicitation` callback into the session; cancellation of the originating request (`ct.cancelled()`) answers
  `cancel`; an `ElicitationPauseState` (`rmcp_client.rs:212-247`) pauses tool-call timeouts while a user is answering.
- **hermes-agent** `tools/mcp_tool_sampling.py:104-224`: per-server sampling config with `max_rpm` 10, `timeout` 30 s,
  `max_tokens_cap` 4096, `max_tool_rounds` 5, `allowed_models`, `model` override; tool-use inside sampling is opt-in
  (`expose_client_tools`, default false) because strict servers reject the unknown sub-capability.

## Design

### 1. Request routing (shared prerequisite)

Server-initiated requests arrive on a connection shared by all threads, without a reliable link to the tool call that
caused them over stdio. Track call scopes:

```ts
interface McpCallScope {
  threadId: string;
  toolCallId: string;
  signal: AbortSignal;
  cwd: string;
}
// McpConnectionManager
private readonly inflight = new Map<string /* server */, McpCallScope[]>();
```

`callTool` pushes a scope before the request and removes it in `finally`. Routing rule for a server request:

1. Exactly one in-flight scope for that server → route to it.
2. Several → route to the most recently started scope and include `serverName` + tool name in the prompt so the
   user can tell which call is asking.
3. None (server-initiated outside a call) → elicitation and sampling are **declined**; roots are answered from the
   connection's cwd set (below).

The originating scope's `signal` aborting answers `cancel` and removes the pending client request.

### 2. Elicitation

Capability: `elicitation: { form: {} }` in phase 1; `url: {}` in phase 2 (opens the browser with the same opener the
OAuth flow uses, `client.ts:283-290`).

**Protocol.** Add a client-neutral server request rather than overloading `userInput/request`, whose schema cannot
express free text, numbers, or booleans:

```ts
// protocol/src/methods.ts — DILIGENT_SERVER_REQUEST_METHODS
ELICITATION_REQUEST: "elicitation/request"

// protocol/src/data-model.ts
ElicitationRequestSchema = z.object({
  threadId: z.string(),
  serverName: z.string(),
  message: z.string(),
  mode: z.enum(["form", "url"]),
  requestedSchema: z.record(z.string(), z.unknown()).optional(), // MCP restricted JSON Schema (primitive props)
  url: z.string().url().optional(),
  source: UserInputSourceSchema.optional(),                       // sub-agent origin, as for userInput
});
ElicitationResponseSchema = z.object({
  action: z.enum(["accept", "decline", "cancel"]),
  content: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).optional(),
});
```

- Runtime validates `content` against `requestedSchema` before returning `accept`; a mismatch is re-asked once, then
  answered `cancel`.
- Prompts go through the same per-thread serialization and connection fan-out as `userInput/request`
  (`requestUserInputFromConnections`). No connection: goal threads pause with `interaction_unavailable`, others
  answer `cancel`.
- **Timeouts:** the per-call `toolTimeoutMs` timer is suspended while an elicitation for that call is pending
  (codex pause-state behavior) and resumes with the remaining budget afterwards.
- **Persistence/logging:** elicitation content is never logged or persisted by the runtime; only the server's tool
  result (which the server controls) enters the session.
- **Clients:** TUI and web each need a form renderer for the MCP primitive subset (string with `enum`/`format`,
  number/integer with min/max, boolean). Both are updated in the same change (`AGENTS.md` protocol rule).
- **Capability negotiation:** MCP connections are process-wide and outlive any one client, so the runtime always
  advertises `elicitation` to MCP servers. Diligent clients declare `elicitation` support in their `initialize`
  params; when no connected client for the routed thread declared it, the runtime answers `cancel` immediately
  instead of sending a request the client cannot render.

### 3. Roots

Capability: `roots: { listChanged: true }`.

- `roots/list` returns `file://` URIs for the **cwd set** of the connection: the cwds of threads that have used the
  server, plus active subagent worktree paths (doc 06). With a single project this is one root.
- When the set changes (new thread cwd, worktree created/removed), send `notifications/roots/list_changed`.
- Roots are advisory in MCP; no enforcement is implied, and the design does not claim any.

### 4. Sampling

Opt-in per server; servers that are not configured never see the capability.

```jsonc
"mcpServers": {
  "docs": {
    "command": "docs-mcp",
    "sampling": {
      "enabled": true,
      "requireApproval": true,        // default true
      "maxTokens": 4096,              // hard cap on the server's requested maxTokens
      "maxRequestsPerMinute": 10,
      "timeoutMs": 30000,
      "modelClass": "lite"            // optional; default = the routed thread's current model
    }
  }
}
```

- Approval (`requireApproval`): `approval/request` with `{permission: "execute", toolName: "mcp_sampling",
  description: "<server> wants to run a model call (<n> messages, ≤ <maxTokens> tokens)", details: {serverName,
  systemPrompt (first 500 chars)}}`. An `always` answer is remembered per server via the existing permission engine.
- The call uses the thread's provider manager so auth, cost accounting, and `usage/updated` stay correct. It is
  stateless: no tools, no session entries, no thinking. `modelPreferences` hints are ignored except to pick within
  `modelClass`.
- Sampling with tools (`sampling.tools`) is not advertised in phase 1.
- Not persisted to the session; one `mcp_sampling` log event records server, model, token usage, duration.

### 5. Tool list changes

Register a `ToolListChangedNotification` handler that re-runs `listTools` (debounced 500 ms), updates the cached tool
definitions, and bumps a manager generation counter. The tool registry is rebuilt at the next turn boundary when the
generation changed — never mid-turn, so a running batch sees a stable tool set.

## Risks

- **Misrouting with concurrent calls** to the same server from several threads; mitigated by labelling the prompt with
  server and tool, and by cancelling with the originating call.
- **Sampling cost abuse** by a server; bounded by approval, rate limit, token cap, and opt-in.
- **Phishing via elicitation** ("enter your password"): clients must render the server name prominently; the MCP spec
  forbids requesting secrets in form mode, and the client shows a fixed warning line.

## Tests

- `packages/runtime/test/tools/mcp/routing.test.ts`: in-flight scope routing rules 1–3; abort answers `cancel`.
- `packages/runtime/test/tools/mcp/elicitation.test.ts`: tool timeout suspended while pending; schema validation.
- `packages/e2e/app-server/mcp-elicitation.test.ts`: a stdio test MCP server elicits during `tools/call`; the JSON-RPC
  client receives `elicitation/request`, answers `accept`, and the tool result reflects the content.
- Sampling: rate limit and approval rejection produce MCP errors, never a thrown runtime error.
