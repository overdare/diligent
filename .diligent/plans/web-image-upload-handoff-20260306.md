# Web Image Upload Handoff — 2026-03-06

## Status

Implemented and validated a first complete checkpoint for Web UI image upload to the LLM.

Scope completed:
- Web UI only
- Vision models only
- Up to 4 images per message
- 10 MB max per image
- Project-local persistence under `.diligent/images/`
- Image-only turns allowed
- Provider support implemented for:
  - Anthropic
  - OpenAI Responses API path
  - ChatGPT OAuth path via shared OpenAI conversion
- Gemini intentionally left without vision support annotation in this checkpoint

## What was changed

### Protocol
- `packages/protocol/src/data-model.ts`
  - Added `local_image` content block with:
    - `path`
    - `mediaType`
    - optional `fileName`
    - optional `previewUrl`
- `packages/protocol/src/client-requests.ts`
  - Extended `turn/start` to accept:
    - `attachments?: local_image[]`
    - `content?: ContentBlock[]`
- `packages/protocol/src/web-requests.ts`
  - Added `image/upload` web request
  - Added `supportsVision` to `ModelInfo`
- `packages/protocol/src/methods.ts`
  - Added `image/upload`

### Core / server
- `packages/core/src/infrastructure/diligent-dir.ts`
  - Added `.diligent/images/`
  - Added `images/` to generated `.gitignore`
- `packages/core/src/types.ts`
  - Added `LocalImageBlock`
- `packages/core/src/provider/types.ts`
  - Added `supportsVision?: boolean` to model type
- `packages/core/src/provider/models.ts`
  - Marked Anthropic and OpenAI known models as `supportsVision: true`
  - Gemini left unmarked in this checkpoint
- `packages/core/src/provider/image-io.ts`
  - New helper to materialize persisted local images into provider-ready base64 image blocks
  - Enforces 10 MB limit when provider reads the image
- `packages/core/src/provider/anthropic.ts`
  - Converts user `local_image` blocks into Anthropic image blocks before sending
- `packages/core/src/provider/openai-shared.ts`
  - Converts user `local_image` blocks into OpenAI `input_image` message content using data URLs
- `packages/core/src/provider/openai.ts`
  - Awaits async OpenAI message conversion
- `packages/core/src/provider/chatgpt.ts`
  - Awaits async shared OpenAI conversion
- `packages/core/src/app-server/server.ts`
  - `turn/start` now accepts image attachments/content
  - Builds block content for image-only and text+image turns
  - Thread list preview now falls back to `[image]` / `[images]` for image-only first turns
- `packages/core/src/session/persistence.ts`
  - Session list first-user preview now supports text extracted from blocks, otherwise `[image]` fallback

### Web
- `packages/web/src/server/index.ts`
  - Exposes `supportsVision` in model metadata
- `packages/web/src/server/rpc-bridge.ts`
  - Added `image/upload`
  - Persists uploaded files into `.diligent/images/<threadId>/...` or `.diligent/images/drafts/...`
  - Returns `local_image` attachment reference to client
- `packages/web/src/client/App.tsx`
  - Tracks pending images
  - Uploads images via `image/upload`
  - Sends message content with `local_image` blocks
  - Supports image-only turns
  - Shows optimistic local user image message immediately
- `packages/web/src/client/components/InputDock.tsx`
  - Added pending image preview row
  - Added hidden file input
  - Added composer action for images
  - Image-aware placeholder when model supports vision
- `packages/web/src/client/components/UserMessage.tsx`
  - Renders attached images in user bubbles
- `packages/web/src/client/components/MessageList.tsx`
  - Passes image metadata to `UserMessage`
- `packages/web/src/client/lib/thread-store.ts`
  - Preserves and hydrates user image blocks into render state

## Tests added/updated

### Core
- `packages/core/test/app-server.test.ts`
  - image-only turn accepted
  - image-only first turn preview becomes `[image]`
- `packages/core/test/diligent-dir.test.ts`
  - verifies `.diligent/images`
  - verifies `images/` in `.gitignore`
- `packages/core/test/provider-models.test.ts`
  - verifies vision support annotations for Anthropic/OpenAI only

### Protocol
- `packages/protocol/test/protocol-flow.test.ts`
  - validates `turn/start` with image attachments/content

### Web
- `packages/web/test/thread-store.test.ts`
  - hydrates local image blocks into user render items
- `packages/web/test/rpc-bridge.test.ts`
  - `image/upload` persists file and returns `local_image`
- `packages/web/test/components.test.tsx`
  - user message renders attached images
  - input dock renders pending image preview/file accept/vision placeholder

## Validation run

Typecheck passed:
- `bun run typecheck`

Targeted tests passed:
- `bun test ./packages/core/test/app-server.test.ts`
- `bun test ./packages/core/test/diligent-dir.test.ts`
- `bun test ./packages/core/test/provider-models.test.ts`
- `bun test ./packages/protocol/test/protocol-flow.test.ts`
- `bun test ./packages/web/test/thread-store.test.ts`
- `bun test ./packages/web/test/rpc-bridge.test.ts`
- `bun test ./packages/web/test/components.test.tsx`

## Important design notes

1. Images are not embedded into session JSON as base64.
   - Session stores `local_image` references only.
   - Actual bytes live under `.diligent/images/`.
   - Provider layer resolves those paths into base64 at send time.

2. This matches the intended handoff-friendly pattern better than session-embedded base64.
   - reload/resume works
   - session files stay smaller
   - future UI can rehydrate previews using `previewUrl` client-side or file path server-side

3. Web currently uses client-generated blob previews.
   - `previewUrl` is UI-local and optional.
   - persisted session history may not have `previewUrl`; thread-store falls back to path
   - this is good enough for current checkpoint, but remote/static serving of stored images is still a possible future improvement

## Remaining gaps / suggested next steps

1. Add actual persisted-image serving for history view
   - Right now history render can fall back to a filesystem path string, which browser `img src` may not load reliably in all environments.
   - Best next step: add a read-only HTTP route or web RPC-backed blob fetch for `.diligent/images/**` and convert stored paths into browser-safe URLs on hydrate.

2. Consider Gemini vision support later
   - Protocol and storage are ready for it
   - provider conversion path still needs implementation if desired

3. Consider cleanup for draft uploads
   - uploads before a real thread association can land under `drafts/`
   - currently acceptable, but later we may want:
     - draft-to-thread migration
     - garbage collection of orphaned drafts

4. Consider broader test coverage
   - provider-level unit tests specifically for local-image materialization into Anthropic/OpenAI request shapes
   - integration test for Web send flow with both text+image and image-only paths

## Files most relevant for continuation

- `packages/web/src/client/App.tsx`
- `packages/web/src/client/components/InputDock.tsx`
- `packages/web/src/client/lib/thread-store.ts`
- `packages/web/src/server/rpc-bridge.ts`
- `packages/core/src/app-server/server.ts`
- `packages/core/src/provider/image-io.ts`
- `packages/core/src/provider/openai-shared.ts`
- `packages/core/src/provider/anthropic.ts`
- `packages/protocol/src/client-requests.ts`
- `packages/protocol/src/data-model.ts`
- `packages/protocol/src/web-requests.ts`

## Branch / commit intent

After writing this file, create a dedicated branch, commit the scoped image-upload work, push it, then verify:
- `git log --oneline -3`
- `git show HEAD --stat`

Per repo knowledge, verify again after push because concurrent sessions can reset/overwrite local branch state.
