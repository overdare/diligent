# Image generation

OVERDARE exposes one `generate_image` tool for generating an image and saving it locally.
Studio import remains a separate operation using the existing
`studiorpc_asset_manager_image_import` tool. Generation does not require a Studio connection
or new Studio RPC methods.

## Tool contract

`generate_image` accepts a `prompt` and optional `referenceImages` file paths. The runtime
binds it to the selected chat provider:

| Selected chat provider | Behavior |
|---|---|
| `chatgpt` | Use the local Codex CLI's managed ChatGPT OAuth account. |
| Other or unknown | Do not expose the image-generation tool. |

The model cannot override this selection through a tool argument. Only ChatGPT exposes image
generation; selecting another provider does not fall back to Codex.

The generation tool description is provider-bound, so unsupported providers do not receive
the tool. The shared `mobile-ui-design` skill checks tool availability before generating art
and does not tell the model to switch providers or fabricate a mockup. Previously loaded conversation history is
not rewritten when switching providers, but the current tool catalog remains authoritative.

The result includes an absolute `file` path, the selected `provider`, its authentication
`source`, and an image preview. Codex may also return `revisedPrompt`.
A provider failure is returned to the caller without automatically retrying
with another provider.

The tool description and failure output instruct the model to stop image work and report the
error. Code-drawn images (PIL, SVG, or canvas), stock assets, and other providers are not
substitutes unless the user explicitly approves an alternative. This is a model-facing
instruction, not a restriction on general-purpose file or shell tools.

For Studio workflows, pass the returned `file` directly to
`studiorpc_asset_manager_image_import`, then use its returned asset ID. Generation itself
does not import an asset or save a Studio level.

When developing with a Mac agent and remote Windows Studio, configure the dev-only shared
file-root mapping described in [the cross-Studio guide](./mac-agent-windows-studio.md#image-import-during-cross-machine-development).
Image generation does not depend on this mapping; only the dev Studio RPC boundary converts
the local file path before import.

## Mobile UI mockups and reference images

The bundled `mobile-ui-design` skill replaces the official-template gate with a visual workflow:
create a mobile screen mockup, use that image as a shared reference for reusable assets, and
implement the requested interactive UI in Studio. Mockup-only requests stop at the design image.
Legacy `ui-generator` and `overdare-ui-templates` entries are disabled upgrade placeholders;
they are not advertised or invocable by the model.

Pass up to five local PNG, JPEG, or WebP files in `referenceImages`. Absolute paths are preferred;
relative paths resolve from the project directory. Approval includes the reference paths before
the tool reads them. References must be existing non-empty files and are never overwritten.
Codex receives them as `localImage` input attachments, not merely filenames in prompt text.

Finish a mockup or anchor image first, then issue independent `generate_image` calls together
using the same references. The tool supports parallel execution and saves each result under a
unique path. Keep Studio imports and edits in the single editing session. For exact shared
button geometry, import one common frame and reuse it behind separate glyphs; reference-guided
generation improves consistency but does not guarantee identical pixels.

## Credentials and local setup

Codex requires a local CLI signed in with managed ChatGPT OAuth and an account exposing
image generation. It does not use Diligent's ChatGPT token store or an OpenAI API key.
The executable defaults to `codex` on PATH; `DILIGENT_CODEX_BIN` can point to another
installed Codex executable.

For local development, set `DILIGENT_CODEX_BIN` in the gitignored `.env.local` file to the
compatible installation you intend to test. For example, when using the CLI bundled with the
macOS ChatGPT app:

```sh
DILIGENT_CODEX_BIN=/Applications/ChatGPT.app/Contents/Resources/codex
```

Restart the dev backend after changing it. The launcher logs the selected executable; check
that executable's `--version` rather than assuming it is the same `codex` found on PATH.

The CLI must support the model selected in the local Codex configuration. A successful
account/capability check does not establish model-version compatibility. If Codex reports
that the selected model needs a newer CLI, use a compatible installation. The tool does not
upgrade the CLI or change the user's model configuration.

## Storage and execution

The storage helper is independent of the image provider. Files are written under
`<project>/.<storage-namespace>/images/generated/` with unique names. PNG, JPEG, and WebP
results retain their image format. The returned preview contains the same bytes as the saved
file.

OVERDARE's runtime passes the selected thread provider into bundled tool factories. Tool
settings and model-facing tools follow that provider. Changing the thread model via `config/set`
uses the existing agent's model setter; only a provider change refreshes its tools on the next
turn. The agent and its state are retained, and an in-flight turn keeps its model and tools snapshot. Generation remains
available for ChatGPT when `STUDIO_DISABLED=1`.

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
checks, thread creation, and image generation.
Cancellation propagates through direct MCP calls and the HTTP router endpoint to the provider.
The Rust MCP router continues reading cancellation notifications while keeping tool calls
serial; cancelling an active call drops its HTTP request, and cancelling a queued call removes
it before execution.

Codex processes are stopped and reaped on success, cancellation, and failure, with forced
termination if graceful shutdown is ignored. Cancelled generations do not advance into saving;
an interrupted file write removes its partial output.

## Ownership

- `sidecar/src/tools/codex-imagegen/`: Codex transport, account checks, and image-turn events.
- `sidecar/src/tools/image-generation/image-store.ts`: Provider-independent local storage.
- `sidecar/src/tools/image-generation/index.ts`: Tool approval, provider selection, and result assembly.
- `sidecar/src/tools/studiorpc/`: Existing Studio import and level persistence.
