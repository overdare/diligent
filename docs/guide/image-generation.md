# Image generation

OVERDARE exposes one `generate_image` tool for generating an image and saving it locally.
Studio import remains a separate operation using the existing
`studiorpc_asset_manager_image_import` tool. Generation does not require a Studio connection
or new Studio RPC methods.

## Tool contract

`generate_image` accepts only a `prompt`. The runtime binds it to the selected chat provider:

| Selected chat provider | Behavior |
|---|---|
| `chatgpt` | Use the local Codex CLI's managed ChatGPT OAuth account. |
| `gemini` | Require the saved Gemini API key and use Gemini's native image model. |
| Other or unknown | Do not expose the image-generation tool. |

The model cannot override this selection through a tool argument. Selecting ChatGPT never
uses Gemini credentials, and selecting Gemini never falls back to Codex.

Generation instructions live in the provider-bound tool description, so unsupported providers
receive neither the tool nor its instructions. The common `ui-generator` skill only describes
importing existing local image files and applying Studio asset IDs; it does not advertise
generation or tell the model to switch providers. Previously loaded conversation history is
not rewritten when switching providers, but the current tool catalog remains authoritative.

The result includes an absolute `file` path, the selected `provider`, its authentication
`source`, and an image preview. Gemini also returns `model`; Codex may return
`revisedPrompt`. A provider failure is returned to the caller without automatically retrying
with another provider.

For Studio workflows, pass the returned `file` directly to
`studiorpc_asset_manager_image_import`, then use its returned asset ID. Generation itself
does not import an asset or save a Studio level.

## Credentials and local setup

Gemini uses the same credential-store mode and saved API key as the product's provider
settings. Legacy keys in `config.jsonc` and ambient environment variables are not separate
credential sources. Environment-backed credentials can use the auth store's
`{env:GEMINI_API_KEY}` substitution. An optional `provider.gemini.baseUrl` is also respected. The image model
is selected by the product's image-generation configuration, independently of the chat model.

Codex requires a local CLI signed in with managed ChatGPT OAuth and an account exposing
image generation. It does not use Diligent's ChatGPT token store or an OpenAI API key.
The executable defaults to `codex` on PATH; `DILIGENT_CODEX_BIN` can point to another
installed Codex executable.

The CLI must support the model selected in the local Codex configuration. A successful
account/capability check does not establish model-version compatibility. If Codex reports
that the selected model needs a newer CLI, use a compatible installation. The tool does not
upgrade the CLI or change the user's model configuration.

## Storage and execution

Both providers use the same storage helper. Files are written under
`<project>/.<storage-namespace>/images/generated/` with unique names. PNG, JPEG, and WebP
results retain their image format. The returned preview contains the same bytes as the saved
file.

OVERDARE's runtime passes the selected thread provider into bundled tool factories. Tool
settings and model-facing tools follow that provider; switching models rebuilds the agent's
tools on the next turn while preserving an in-flight turn's model snapshot. Generation remains
available for ChatGPT/Gemini when `STUDIO_DISABLED=1`.

Standalone MCP, the HTTP MCP router, and the product tool CLI do not receive the calling chat's
model provider, so they do not expose `generate_image`. They do not infer it from credentials,
client names, or a different chat's persisted configuration.

The Codex adapter uses one process per generation, with separate responsibilities:

- `process.ts` owns process lifetime and line I/O.
- `rpc-client.ts` continuously reads the wire, correlates responses by request ID, and buffers
  notifications with the existing core `EventStream`. Waiting for a response never stops
  notification delivery, and unread notifications never block a response.
- `protocol.ts` validates the consumed fields with Zod and infers TypeScript types from those
  schemas, without vendored protocol declarations.
- `app-server-client.ts` starts a turn and collects its images. Success requires both the start
  acknowledgement and successful completion; either request failure or turn failure rejects
  immediately, regardless of their arrival order.
- `generate.ts` checks authentication/capability, selects the last usable saved image from the
  completed turn, and closes the client in `finally`. It does not handle wire ordering.

The request/event separation follows the
[official client design](https://github.com/openai/codex/blob/5ecb3afd1bf405149e2159bfda50093b0c1b5fab/codex-rs/app-server-client/src/remote.rs#L255)
without embedding the Rust runtime or copying its generated types. The adapter validates only
the fields it consumes; unrelated response fields do not require local type declarations.

Codex uses one five-minute deadline covering initialization, authentication and capability
checks, thread creation, and image generation. Gemini also has a five-minute request deadline.
Cancellation propagates through direct MCP calls and the HTTP router endpoint to the provider.
The Rust MCP router continues reading cancellation notifications while keeping tool calls
serial; cancelling an active call drops its HTTP request, and cancelling a queued call removes
it before execution.

Codex processes are stopped and reaped on success, cancellation, and failure, with forced
termination if graceful shutdown is ignored. Cancelled generations do not advance into saving;
an interrupted file write removes its partial output.

## Ownership

- `sidecar/src/tools/codex-imagegen/`: Codex transport, account checks, and image-turn events.
- `sidecar/src/tools/image-generation/gemini.ts`: Gemini API request and response handling.
- `sidecar/src/tools/image-generation/image-store.ts`: Provider-independent local storage.
- `sidecar/src/tools/image-generation/index.ts`: Tool approval, provider selection, and result assembly.
- `sidecar/src/tools/studiorpc/`: Existing Studio import and level persistence.
