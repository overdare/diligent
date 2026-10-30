# Provider auth

This guide describes the current provider authentication model in Diligent.

## Overview

Diligent currently supports two broad auth paths:

- API-key-backed providers
- runtime-managed ChatGPT OAuth

These auth flows are runtime-managed and shared across clients through the app-server RPC surface.

Supported providers in the protocol/runtime are:

- `anthropic`
- `openai`
- `chatgpt`
- `gemini`
- `vertex`
- `zai-coding-plan`

## Auth storage

Auth state is persisted using `provider.auth.credentialsStore`, which defaults to `auto`:

- `auto`: prefer OS keyring, fall back to `~/.diligent/auth.jsonc`
- `keyring`: require OS keyring storage
- `file`: always use `~/.diligent/auth.jsonc`
- `ephemeral`: process-local in-memory storage only

In keyring-backed modes, the full auth payload is serialized as JSON and stored in the OS credential store. Diligent does not add its own encryption layer; protection is delegated to the OS keychain / credential manager. Successful keyring writes remove any stale fallback auth file.

The auth store uses JSONC parsing and supports `{env:VAR}` substitution when values are read. The stored schema is strict, and invalid content falls back to an empty auth state rather than partially loading unknown fields.

File-backed auth writes create parent directories as needed and tighten file permissions after write.

Example config:

```jsonc
{
  "provider": {
    "auth": {
      "credentialsStore": "auto"
    }
  }
}
```

Current persisted shape:

```jsonc
{
  "anthropic": "sk-ant-...", // optional
  "openai": "sk-...", // optional
  "chatgpt": "...", // optional, legacy/plain-key slot
  "gemini": "AIza...", // optional
  "zai-coding-plan": "your-api-key", // optional
  "chatgpt_oauth": {
    "access_token": "...",
    "refresh_token": "...",
    "id_token": "...",
    "expires_at": 1735689600000,
    "account_id": "..." // optional
  }
}
```

Notes:

- In the current app-server flow, ChatGPT authentication uses `chatgpt_oauth` (not `chatgpt` API key).
- `{env:VAR}` expansion happens on read and unresolved env vars become an empty string.
- If the file has unknown fields, the strict schema rejects the content and runtime treats auth as empty (`{}`).

## API key flow

The auth store currently supports plain API keys for:

- `anthropic`
- `openai`
- `gemini`
- `zai-coding-plan`

Vertex uses runtime-managed access-token auth instead of a long-lived API key.

## z.ai Coding Plan API-key flow

z.ai Coding Plan support uses the `zai-coding-plan` provider and targets the z.ai Coding Plan OpenAI-compatible Chat Completions endpoint for `glm-*` models.

Practical notes:

- configure with `auth/set` or `~/.diligent/auth.jsonc`
- runtime stores the plain API key in the same auth store as other API-key providers
- the default built-in model for this provider is `glm-5.2`
- the default base URL is `https://api.z.ai/api/coding/paas/v4`
- environment fallback is supported through `ZAI_CODING_PLAN_API_KEY`

## Vertex AI access-token flow

Vertex support uses the `vertex` provider and targets the Vertex AI OpenAI-compatible Chat Completions endpoint.

Runtime config shape:

```jsonc
{
  "model": { "provider": "vertex", "modelId": "vertex-gemma-4-26b-it" },
  "provider": {
    "vertex": {
      "project": "my-gcp-project",
      "location": "global",
      "endpoint": "openapi",
      "authMode": "adc"
    }
  }
}
```

Supported initial auth modes:

- `access_token_command`
- `access_token`
- `adc`

Current behavior:

- `access_token_command` runs a local command and uses trimmed stdout as the bearer token
- `adc` uses the command-backed refresh path and defaults to `gcloud auth application-default print-access-token`
- runtime runs that command through `bash -lc` on Unix-like platforms
- on Windows, the default ADC command is invoked via `cmd.exe /d /s /c "gcloud.cmd auth application-default print-access-token"` to avoid PowerShell execution-policy issues and `.cmd` spawn resolution differences
- custom `access_token_command` values on Windows still run through `powershell -NoProfile -Command`
- `access_token` uses a static token supplied in config
- `project`, `location`, and `endpoint` are required when `provider.vertex` is present
- if `baseUrl` is omitted, runtime derives it from `project`, `location`, and `endpoint`
- for MAAS publisher models that are global-only, set `location` to `global`

Vertex auth is bound into `ProviderManager` as external auth, similar to ChatGPT OAuth in lifecycle shape but without browser OAuth.

These keys are loaded by runtime and then bound into provider access through shared provider-auth wiring.

At runtime startup:

1. `loadAuthStore()` reads `auth.jsonc`
2. plain string keys are injected into `ProviderManager` via `setApiKey(...)`
3. provider/model availability is derived from configured providers

API-key operations over RPC:

- `auth/set` stores a key and updates `ProviderManager`
- `auth/remove` deletes a key and updates `ProviderManager`

After each update, server emits `account/updated` with fresh provider status.

## ChatGPT OAuth flow

ChatGPT OAuth is a separate auth path.

- `chatgpt` does not use `auth/set` API-key storage
- OAuth start is triggered through `auth/oauth/start`
- OAuth is currently specific to the ChatGPT provider path

The current flow uses PKCE, a local callback server, and runtime-managed token persistence.

Concrete flow:

1. Client calls `auth/oauth/start` with `{ provider: "chatgpt" }`
2. Runtime creates PKCE request and opens browser to `https://auth.openai.com/oauth/authorize`
3. Runtime waits on local callback: `http://localhost:1455/auth/callback`
4. Runtime exchanges auth code at `https://auth.openai.com/oauth/token`
5. Runtime stores `chatgpt_oauth` tokens in the configured auth credential store
6. Runtime binds ChatGPT external auth into `ProviderManager`
7. Runtime emits:
   - `account/login/completed` (success/failure)
   - `account/updated` (provider status refresh)

Behavioral constraints:

- OAuth start only accepts `provider: "chatgpt"`
- concurrent OAuth starts are rejected (`OAuth flow already in progress`)
- current callback wait timeout is 5 minutes

## GPT Fast mode

Fast mode is an independent processing-speed preference for supported `openai` API-key and
`chatgpt` subscription models. It does not change the selected model or reasoning effort.

- **Web:** open the composer model selector and toggle **Fast mode**.
- **TUI:** open `/model` and select **Fast mode: On/Off**, or use `/fast`, `/fast on`, or `/fast off`.
- Fresh clients start with Fast mode off. The preference is saved per thread and restored when
  resuming it. New conversations use the current client's preference.
- Changes apply on the next turn, not partway through an active tool loop. Child agents inherit
  the preference; unsupported models ignore it. Switching to an unsupported model hides the Web
  toggle and the Fast status indicator without discarding the preference.
- Supported GPT requests explicitly send `service_tier: "priority"` when enabled and
  `service_tier: "default"` when disabled, including ChatGPT HTTP/SSE and WebSocket Responses Lite.
  `priority` is OpenAI's compatible name for the Fast tier.
- Fast mode increases API costs or subscription usage. Availability and actual processing speed
  depend on the provider and account; OpenAI may downgrade a request to the standard tier.
  Diligent's token-cost estimates still use catalog base rates, not service-tier billing.

The shared protocol exposes `ModelInfo.supportsFastMode`, `thread/start.fastMode`,
`fastMode/set { threadId?, fastMode }`, and `thread/read.currentFastMode`. Session files record
`fast_mode_change` entries, which also appear in the debug viewer.

See [OpenAI Fast mode](https://developers.openai.com/api/docs/guides/fast-mode) and
[Codex speed and usage](https://developers.openai.com/codex/speed) for provider policies and pricing.

## ChatGPT subscription transport

The ChatGPT Codex endpoint only accepts `store: false`, and rejects `previous_response_id` over
HTTP. Responses Lite models therefore use the Codex WebSocket transport by default:

- One socket per conversation. The runtime `TurnOrchestrator` owns a stream session scope
  (`createStreamSessionScope`) and hands it to every turn as `turnScope.session`; the socket and its
  chain baseline live there and are released when the session is re-created, resumed, or deleted.
- After a completed response, the next request on the same socket sends only the appended input
  items with `previous_response_id`. The strict-prefix check lives in the provider-neutral
  `openai/responses-chain.ts`; any history edit, compaction, option change, or new socket sends the
  full input instead.
- The server keeps chained responses only in that connection's memory (connections last at most
  60 minutes). A rejected `previous_response_id`, or a reused socket that sends no first frame within
  30 seconds, replays the full input on a fresh socket inside the same provider call.
- The socket is not tied to one turn, so it carries no `x-codex-turn-state`; that sticky-routing
  token is used only by HTTP/SSE requests within a turn.
- Two consecutive WebSocket transport failures switch that ChatGPT stream instance to HTTP/SSE, which
  resends the full input each request.

Every HTTP provider path (ChatGPT HTTP/SSE, the OpenAI and Anthropic SDK clients) waits up to
`PROVIDER_RESPONSE_HEADER_TIMEOUT_MS` (300 seconds) for response headers. Headers arrive only after
the request body is uploaded and the server accepts the request, so long transcripts need the same
bound as the stream idle timeout.

Set `DILIGENT_DEBUG_CHATGPT_WEBSOCKET=1` to log content-safe frame summaries, including
`inputItems=` counts that show whether a request was chained.

## Anthropic image uploads

The Anthropic Messages API keeps no conversation state, so every request resends the whole history,
and the request body is limited to 32 MB. Base64 images make up most of that body in long sessions.

- On the official endpoint (`https://api.anthropic.com`), the provider uploads each distinct image once
  through the Files API and sends `{ "type": "file", "file_id": ... }` instead of base64. Streaming and
  native compaction share the uploads per API key for the life of the process.
- Requests that reference files add the `files-api-2025-04-14` beta header.
- A custom `provider.anthropic.baseUrl` keeps sending base64, because a proxy may not serve `/v1/files`.
- After the first upload failure, the provider stops uploading and sends images inline for the rest of
  the process.
- If Messages answers a file-referencing request with 400, 403, or 404 before any output, the provider
  resends the same request with base64 images. When that inline request succeeds, the file references
  were the cause, so later requests send base64 for the rest of the process. When it also fails, the
  error is unrelated to files and file references stay on.
- Uploaded files are not deleted. They stay in the API key's workspace, visible to every key with access
  to that workspace. The Files API is not eligible for Zero Data Retention.

## Refresh and runtime binding

Runtime binds external auth into `ProviderManager` and refreshes ChatGPT OAuth tokens automatically before provider use when needed.

Refresh handling is serialized so concurrent refresh attempts do not race each other.

Refresh specifics:

- tokens are considered refresh-needed when expiry is within 5 minutes
- refresh uses `grant_type=refresh_token`
- refreshed tokens are persisted through the binding callback (`onTokensRefreshed`)

Important current behavior:

- on request dispatch, `ProviderManager` triggers `ensureFresh()` without awaiting it
- this means first request near expiry may race with refresh; subsequent requests use refreshed tokens once saved

## RPC and UI surface

The current auth-related RPC surface is:

- `auth/list`
- `auth/set`
- `auth/remove`
- `auth/oauth/start`

The server also emits account/auth-related notifications so clients can refresh visible provider state after login or account changes.

Payload highlights:

- `auth/list` returns:
  - `providers: ProviderAuthStatus[]`
  - `availableModels: ModelInfo[]`
- `ProviderAuthStatus` includes:
  - `provider`
  - `descriptor` (`displayName`, `authMethod`, and optional API-key URL/placeholder)
  - `configured`
  - `maskedKey` (optional)
  - `oauthConnected` (optional, currently used for ChatGPT)

Current client behavior:

- Web listens to both `account/login/completed` and `account/updated`
- TUI waits for `account/login/completed` during `/provider set chatgpt`
- app-server opens external browser server-side (important for Desktop/Tauri integration)

Provider presentation metadata has one runtime source of truth in
`packages/runtime/src/provider/descriptors.ts`. Core key validation never adds provider labels or recovery copy: it
throws a classified `ProviderError`, and runtime maps that diagnostic to the shared user-facing message before the RPC
error reaches a client.

## Practical notes

- API key auth and ChatGPT OAuth are intentionally distinct flows
- Auth state is user-global, while project continuity remains project-local
- Runtime owns auth persistence and refresh logic; clients mainly initiate actions and reflect resulting state

Failure/edge cases to expect:

- invalid or schema-mismatched `auth.jsonc` is ignored as empty auth state
- ChatGPT passed to `auth/set` is rejected (`ChatGPT uses OAuth login, not API keys`)
- OAuth callback state mismatch or timeout fails login and emits unsuccessful `account/login/completed`
- removing `chatgpt` auth clears both plain key slot (if any) and `chatgpt_oauth`, then unbinds external auth

## Key code paths

- `packages/runtime/src/auth/auth-store.ts`
- `packages/runtime/src/auth/provider-auth.ts`
- `packages/runtime/src/auth/chatgpt-oauth.ts`
- `packages/runtime/src/app-server/config-handlers.ts`
- `packages/runtime/src/config/runtime.ts`
- `packages/core/src/llm/provider-manager.ts`
- `packages/core/src/auth/types.ts`
- `packages/core/src/auth/chatgpt-oauth/chatgpt-oauth.ts`
- `apps/overdare-ai-agent/sidecar/src/web/client/lib/auth-api.ts`
- `apps/overdare-ai-agent/sidecar/src/web/client/lib/use-provider-manager.ts`
