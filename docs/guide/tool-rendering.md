# Tool rendering

This guide describes the tool-rendering flow that exists in the repository today.

## Verified contract

Structured tool rendering is part of the shared protocol contract.

`@diligent/protocol` defines `ToolRenderPayload` as:

- `inputSummary?`
- `outputSummary?`
- `blocks`

The protocol package also defines the supported block types, including `summary`, `text`, `key_value`, `list`, `table`, `asset_gallery`, `tree`, `status_badges`, `file`, `command`, and `diff`.

Tool render payloads can appear on tool events and on `tool_result` messages.

## Current ownership

- `@diligent/runtime` generates structured tool render payloads for built-in tools.
- `@diligent/runtime` validates plugin-provided render payloads against the protocol schema.
- `@diligent/protocol` owns the shared schema for render payloads and blocks.
- Web and TUI validate incoming render payloads and render the block structure they receive.

## Current flow

1. Runtime creates a start render payload for a tool call when it has an input summary to show.
2. Runtime creates an end render payload from tool output, using per-tool strategies when available and a text fallback otherwise.
3. Protocol schemas validate the render payload shape.
4. Web and TUI merge start/end payloads so the final item can keep the start `inputSummary` when the end payload omits it.
5. Web and TUI render the shared block structure using client-specific presentation.

## What clients currently do

Web and TUI do not define their own independent tool-output schema.

They do, however, own presentation details:

- Web renders block types into React UI components.
- TUI renders the same block types into terminal text output.

That means shared meaning should normally be introduced through runtime and protocol, while client changes can still differ in presentation and interaction details.

## Change checklist

1. Check whether the change requires a new shared block shape or payload field.
2. If it does, update `@diligent/protocol` first.
3. Update runtime render generation or validation as needed.
4. Update both Web and TUI renderers for the affected block or payload behavior.
5. Add or update tests at the layer that owns the changed behavior.

## Key code paths

- `packages/protocol/src/data-model.ts`
- `packages/runtime/src/tools/render-strategies.ts`
- `packages/runtime/src/tools/plugin-loader.ts`
- `apps/overdare-ai-agent/sidecar/src/web/client/lib/tool-reducer.ts`
- `apps/overdare-ai-agent/sidecar/src/web/client/components/ToolRenderBlocks.tsx`
- `packages/cli/src/tui/components/thread-store-utils.ts`
- `packages/cli/src/tui/render-blocks.ts`

## Asset discovery and optional selection

`overdaresearch(source="assets")` defaults to `requestUserInput=false`. It returns
candidate metadata (including `description` and `imageUrl`) and detected packs,
without selecting the top result or opening a picker. The agent chooses IDs for
the existing import tools. Single matches and Audio/Animation/Effects/UI assets
follow the same behavior. A pack-only response still returns its detected packs.

Set `requestUserInput=true` to offer the user an asset or pack choice through the
shared `request_user_input` channel. The picker uses
`UserInputQuestion.display: "asset"`; asset options carry a `value` (asset ID) and
visual `asset` fields, while packs and `None of these are suitable` use text rows.
Web and TUI submit the same values. The old `selectable` tool parameter has been
replaced by `requestUserInput`.

The result metadata distinguishes `selectionStatus` values `selected`, `none`,
`cancelled`, and `custom`. Only an offered asset or pack selection carries a
selected ID or keyword. Free-text feedback is not an asset ID. Picking a pack
returns its member palette; it does not import the entire collection.

`overdaresearch_deep(action="asset-pack", packKeyword=...)` reads a pack palette
without a picker. Each member has a description and optional image URL. The
agent selects only the members needed for the scene.

A displayed thumbnail does not enter model image context. For visual judgment,
`overdaresearch_deep(action="asset-preview", urls=[...])` reads one to four
PNG/JPEG/WebP catalog thumbnails and returns actual `outputImages` with zero-based indices
mapping each successful URL to its image. Failed URLs have individual errors.
The reader accepts HTTPS `asset-prod.cdn.overdare.com` URLs, rejects redirects,
limits downloads to two at a time, and caps source bytes at 5 MiB per image and
10 MiB per call. Existing `origin-file` deep reads retain their contract.
