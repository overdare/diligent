# Image generation

OVERDARE exposes one `generate_image` tool for generating an image and saving it locally.
Studio import remains a separate operation using the existing
`studiorpc_asset_manager_image_import` tool. Generation does not require a Studio connection
or new Studio RPC methods.

## Tool contract

`generate_image` accepts a `prompt`, optional `referenceImages` file paths, an optional image
`model`, and `background` (`auto`, `opaque`, or `transparent`; omitted means `auto`). The runtime
binds it to the selected chat provider:

| Selected chat provider | Behavior |
|---|---|
| `chatgpt` | Call the subscription image endpoint with Diligent's ChatGPT OAuth binding. |
| Other or unknown | Do not expose the image-generation tool. |

The model cannot override this selection through a tool argument. Only ChatGPT exposes image
generation; selecting another provider does not fall back to Codex.

The generation tool description is provider-bound, so unsupported providers do not receive
the tool. The shared `gui-builder` skill checks tool availability before generating art
and does not tell the model to switch providers or fabricate a mockup. Previously loaded conversation history is
not rewritten when switching providers, but the current tool catalog remains authoritative.

The result includes an absolute `file` path, the selected `provider`, its authentication
`source` (`chatgpt-oauth`), and an image preview. `requestedModel` and `requestedBackground`
record the request. `model` and `background` are included only when reported by the backend;
they are not inferred from the prompt, filename, or HTTP success.
For `background: "transparent"`, `transparency` separately reports decoded original-pixel
counts and a status: `has_transparency`, `opaque`, `empty`, or `unknown` if inspection was
unavailable. Opaque/empty outputs include a warning and repair guidance but retain their saved
file for reference-driven retries. Pixel transparency does not establish clean edges or correct
placement; inspect the artwork before importing it.
A provider failure is returned to the caller without automatically retrying
with another provider.

The tool description and failure output allow the initial call plus two retries or repairs
with the same tool, then direct GUI tasks to continue with native Studio panels, text, and controls.
Recoverable input errors should be corrected before retrying. Cancellation or rejection does
not authorize a retry or fallback. Code-drawn images (PIL, SVG, or canvas), stock assets, and other
providers still require explicit user approval. This is model-facing guidance; the tool does
not retry internally or block general-purpose file or shell tools.

For Studio workflows, pass the returned `file` directly to
`studiorpc_asset_manager_image_import`, then use its returned asset ID. Generation itself
does not import an asset or save a Studio level.

When developing with a Mac agent and remote Windows Studio, configure the dev-only shared
file-root mapping described in [the cross-Studio guide](./mac-agent-windows-studio.md#image-import-during-cross-machine-development).
Image generation does not depend on this mapping; only the dev Studio RPC boundary converts
the local file path before import.

## Image-guided mobile GUI construction

The bundled `gui-builder` skill builds actual GUI using generated images and native Studio fonts. It first creates
a guide image tailored to the current game's atmosphere, scene/UI context, and requested screen.
That image is attached as the shared reference for reusable artwork, then the native GUI is
constructed and verified in Studio. Producing the guide alone does not complete the GUI task.
Guide generation, button/frame artwork generation and import, GUI binding, and verification
remain separate plan stages. Each planned visual piece must map to a reused asset ID or a
generated file, imported ID, and target binding, or an explicit fallback after its retry budget.
`ImageButton` and `ImageLabel` are native GUI instances; editable controls do not imply replacing
generated artwork with plain Frames or TextButtons. Missing gameplay code is reported separately.
There is no bundled genre-image library or template-selection gate. New GUI and full visual redesign
requests use this image-guided workflow by default; explicit no-generation or existing-assets-only
requests override it. Focused font, text, layout, or behavior edits load only their relevant references.
Legacy `ui-generator` and `overdare-ui-templates` entries are disabled upgrade placeholders;
they are not advertised or invocable by the model.

Before generating the guide, the skill selects typography from the supplied internal Studio
font catalog. The full family IDs and supported Weight/Style combinations live in its
`references/fonts.md`, loaded when choosing or changing fonts. Generated lettering is only
visual intent: final labels and counters use native TextLabel/TextButton `FontFace` values.
The sidecar adds the internal Font tag; authored requests specify Family, Weight, and Style
together. Readback checks the selected value, while actual glyph coverage, wrapping, and
clipping still require visual verification. No font binaries or additional font service are bundled.

Mobile HUD design starts with required touch actions, not only information panels. Manual-fire
shooters need a visible fire control, reachable movement/aiming input, and the other supported
actions. The skill maps active system controls before generating the guide. It includes one
viewport-focused system-control reference because gameplay captures can omit CoreGui. This is
layout context, not a visual theme or an asset to import into the level. Font-only work does not load it.

If default jump conflicts with a new/full HUD design, the skill can integrate a working custom
jump while preserving the joystick and existing movement rules. The conditional `custom-jump.md`
reference covers connection, visibility, respawn, and verification; small unrelated edits do not
replace system controls.

For transparent assets, the skill distinguishes real alpha from a baked checkerboard and uses
the remaining retry budget for reference-guided background repair. Execution errors and visual
defects share the three-attempt limit for each image. After the third failure, the GUI continues
with native controls and an explicit report of the substituted artwork, preserving successful
assets. A missing remote screenshot is first resolved to a verified agent-host path rather than
being discarded to bypass the failed generation.

The optional temporary chroma-key path for opaque assets generates a flat green (or blue) background
and runs the skill's `scripts/chroma_key.py` locally to create a separate RGBA PNG. It requires a
host Python 3 environment with Pillow; Diligent does not install it. The script preserves the source,
refuses output overwrite, and removes key-color contamination from keyed edge pixels. The key must
not appear in the subject, and translucent materials keep the normal alpha workflow. Only the
processed PNG is imported into Studio. Image calls retain the same retry budget.

Pass up to five local PNG, JPEG, or WebP files in `referenceImages`. Absolute paths are preferred;
relative paths resolve from the project directory. Approval includes the reference paths before
the tool reads them. References must be existing non-empty files and are never overwritten.
References are sent as inline image data to the edits endpoint, not merely filenames in prompt text.
Each file must be at most 32 MiB.

Finish the game-specific guide or anchor image first, then issue independent `generate_image` calls together
using the same references. The tool supports parallel execution and saves each result under a
unique path. Keep Studio imports and edits in the single editing session. For exact shared
button geometry, import one common frame and reuse it behind separate glyphs; reference-guided
generation improves consistency but does not guarantee identical pixels.

## Credentials and local setup

Sign in to ChatGPT in Diligent. Image calls reuse its live OAuth binding and the same
single-flight refresh used by chat requests. No Codex executable, Codex configuration, or
separate API key is required. Credentials stay behind the provider boundary; bundled tools
receive a generation capability, not tokens or a credential-store reader.

The client calls `https://chatgpt.com/backend-api/codex/images/generations`, or `images/edits`
when references are present. It sends the requested model and background explicitly and asks
for PNG output. These subscription endpoints are distinct from the public API-key Images API.
Their acceptance of a model string is not proof of model selection: a diagnostic request using
an invalid model name also returned an image. The default requested model is
`gpt-image-2.5-sunburst`; actual 2.5 serving has not been established.

For transparent assets, pass `background: "transparent"` and inspect the delivered pixels.
Neither PNG format, a successful response, nor an alpha channel alone proves a transparent
background. Explicit-background requests have produced both real RGBA and opaque RGB in
[upstream reports](https://github.com/openai/codex/issues/40572). Keep requested settings,
reported settings, and actual alpha inspection separate; follow the repair budget above
when the returned image is unusable.

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

Image generation uses direct HTTP with a five-minute deadline covering reference loading,
authentication readiness, generation, and saving. Cancelling a caller waiting for shared token
refresh does not cancel other callers' refresh. If the login changes during readiness, the
request fails instead of using the previous account.
Cancellation propagates through direct MCP calls and the HTTP router endpoint to the provider.
The Rust MCP router continues reading cancellation notifications while keeping tool calls
serial; cancelling an active call drops its HTTP request, and cancelling a queued call removes
it before execution.

No child process or ephemeral chat thread is created. Cancelled generations do not advance into saving;
an interrupted file write removes its partial output.

## Ownership

- `packages/core/src/llm/provider/chatgpt/image-generation.ts`: Direct OAuth HTTP request/response handling.
- `packages/core/src/llm/provider-manager.ts`: Live provider capability selection and authentication readiness.
- `packages/runtime/src/auth/provider-auth.ts`: Shared ChatGPT OAuth tokens and refresh lock.
- `sidecar/src/tools/image-generation/image-store.ts`: Provider-independent local storage.
- `sidecar/src/tools/image-generation/index.ts`: Tool approval, provider selection, and result assembly.
- `sidecar/src/tools/studiorpc/`: Existing Studio import and level persistence.
