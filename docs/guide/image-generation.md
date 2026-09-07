# Image generation

OVERDARE exposes one `generate_image` tool for generating an image and saving it locally.
Studio import remains a separate operation using the existing
`studiorpc_asset_manager_image_import` tool. Generation does not require a Studio connection
or new Studio RPC methods.

## Tool contract

`generate_image` accepts a `prompt` and an optional `provider`:

| Provider | Behavior |
|---|---|
| `auto` (default) | Use Gemini when a Gemini API key is configured; otherwise use Codex. |
| `gemini` | Require a Gemini API key and use Gemini's native image model. |
| `codex` | Use the local Codex CLI's managed ChatGPT OAuth account. |

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

The tool is registered in the OVERDARE bundled tools, MCP catalog, router catalog, and
product tool CLI. It stays registered when `STUDIO_DISABLED=1`.

The Codex adapter uses a typed client over one sequential message stream per generation.
Process lifetime and line I/O live in `codex-imagegen/process.ts`; the client owns protocol
validation and turn-event ordering. The image workflow consumes typed events and closes its
client in `finally`, without a request map or notification-waiter registry.

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
