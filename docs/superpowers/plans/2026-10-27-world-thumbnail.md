# World Thumbnail Implementation Plan

> **For agentic workers:** Implement inline using superpowers:executing-plans and test-driven-development.

**Goal:** Ship a bundled OVERDARE skill that creates a game-specific Nutty thumbnail and delivers one upload-ready PNG with a project-folder link.

**Architecture:** Keep generation in the existing ChatGPT image tool. Add a local `prepare_world_thumbnail` companion tool that normalizes a generated image without another model call. Reuse core's bundled WASM codecs for portable square cropping, resizing, and PNG encoding; keep product dimensions and storage in the sidecar.

**Tech Stack:** Bun, TypeScript, Zod, existing jSquash WASM codecs, bundled Markdown skills.

**Spec:** User requirements and approved scope in this conversation (2026-10-27), summarized below.

## Global Constraints

- Inspect current Studio code, hierarchy, and assets before composing the image; incorporate user preferences and ask for missing title decisions.
- Bundle the two supplied images as Nutty identity/rendering references; do not infer game mechanics from their scenery.
- Deliver exactly 1080x1080 PNG, strictly below 10,000,000 bytes.
- Save under the current project's `thumbnails/` folder and return image and folder links. Users upload manually.
- No separate 250x250 file; assess readability at mobile display size and present the 1080x1080 image.
- Preserve originals and existing thumbnails. No new dependencies or frontend-specific workflow.
- Use current checkout without touching pre-existing unrelated changes. No commit/publish is required.

## Evidence

Two live requests through Diligent's existing ChatGPT image provider returned 1254x1254 PNGs even with an exact 1080x1080 prompt; one additionally sent `size: "1080x1080"`. Requested model: `gpt-image-2.5-flare`; backend did not report the served model. PNG sizes were 1,725,317 and 1,572,941 bytes. Local resizing produced a verified 1080x1080 PNG of 1,410,852 bytes. Exact output must therefore be enforced locally.

## Review Focus

- Landscape/portrait sources must crop proportionally, without stretching or hiding an unreported crop.
- JPEG/WebP input must become actual PNG bytes, not a renamed file.
- Cancellation/rejection, malformed input, and oversized decoded images must not leave output files.
- Output directory symlinks must not redirect writes outside the project; repeated runs must not overwrite files.
- Skill questions and references must preserve user intent and distinguish inspected gameplay from decorative reference content.

### Task 1: Square PNG transformation

Files: `packages/core/src/llm/image-resize.ts`, `packages/core/src/contracts/image.ts`, `packages/core/test/llm/image-resize.test.ts`.

- [x] Add failing tests for center-crop pixels, exact output dimensions, real format conversion, invalid sizes/data, and cancellation.
- [x] Implement/export `resizeImageToSquarePng(bytes, mediaType, size, options?)`, returning PNG bytes and source/crop/output dimensions.
- [x] Run the core image tests; inspect decoded output pixels, not only headers.

### Task 2: Project thumbnail finalization

Files: `sidecar/src/tools/image-generation/thumbnail.ts`, `sidecar/src/tools/image-generation/index.ts`, `sidecar/test/tools/image-generation/thumbnail.test.ts` (under `apps/overdare-ai-agent`).

- [x] Write failing tool tests for exact output, folder/file paths, original preservation, repeat saves, approval, cancellation, invalid input, and symlink containment.
- [x] Register `prepare_world_thumbnail({ sourceImage })` beside generation. Ask the host for approval before reading; normalize with Task 1; verify byte limit; save exclusively to a unique project `thumbnails/` PNG; return `file`, `directory`, dimensions, byte count, crop details, and an inline image.
- [x] Run all sidecar image-tool tests.

### Task 3: Bundle the skill and verify delivery

Files: `bootstrap/skills/world-thumbnail/SKILL.md`, its `assets/`, `bootstrap/skills-manifest.json`, `bootstrap/skills/image-asset-generation/SKILL.md` (under `apps/overdare-ai-agent`), and `docs/guide/image-generation.md`.

- [x] Author bounded Studio inspection, title/user clarification, Nutty references, game-specific mobile composition, generation, local finalization, visual review, and file/folder delivery.
- [x] Copy supplied references verbatim, register the skill, and route thumbnail requests from the general asset skill.
- [x] Validate skill/frontmatter and packaging, run scoped tests and type checks, and normalize the live probe image through the shipped tool to inspect the final file.
- [x] Review the complete diff and record verification results below.

## Execution Record

Scope is approved by the user, including the correction to omit a separate 250x250 preview. Proceed inline without another approval checkpoint.


### Verification

- Core image tests: 26 passed, including exact dimensions, center-crop pixels, JPEG/WebP-to-PNG conversion, invalid inputs, and cancellation.
- Sidecar image tests: 40 passed, including rejection, output containment, preserved originals, and permission allow/deny/remembered-directory scope.
- Bootstrap manifest tests: 4 passed. Skill quick validation passed using the bundled Python runtime (system Python lacks PyYAML).
- Native sidecar compilation passed (1,575 modules). No new codecs or native dependencies were added.
- Full repository TypeScript checks passed again after the permission fix and JPEG regression test.
- Live-provider source finalized through the actual registered tool: 1080x1080 PNG, 1,621,329 bytes; decoded and visually inspected. No small preview file was created by the implementation.
- Independent review found a missing permission subject on the write request. Added failing allow/deny tests, supplied the canonical output file via `file_path`, scoped remembered permissions to the thumbnail directory, and reran successfully.
- Broad suites were also run: root 2,761 passed / 12 failed; sidecar 1,481 passed / 21 failed / 2 errors. These runs are not green. Many failures are local listener or filesystem/keyring restrictions; others concern untouched behavior. No out-of-scope fixes were made. Exact failing test names follow, so these results are not represented as a clean full-suite run.

Root full-suite failures:

- Fast mode persists across server restart, stays thread-local, and toggles the wire service tier
- a Fast mode change during a tool turn applies only to the next turn
- collectPluginHooks > loads only explicitly configured hooks in explicit discovery mode
- enhanced runtime eval behaviors > surfaces fixture MCP needs_auth and abstains without advertising a callable tool
- keyring storage > load returns empty when keyring backend is unavailable
- loadRuntimeConfig > reads auth credential store mode from config
- progressive session RPC > concurrent restores repair an orphaned tool call only once
- resolveRgBinary > falls back to a bundled assets/bin binary next to execPath
- websocket-transport > approval request and response survive bidirectional WebSocket serialization
- websocket-transport > connect, initialize, and disconnect over real WebSocket
- websocket-transport > thread/start returns threadId and emits THREAD_STARTED notification over WebSocket
- websocket-transport > turn/start triggers turn notifications over real WebSocket transport

Sidecar full-suite failures:

- (unnamed)
- DiligentAppServer multi-connection (web) > image/upload: persists file and returns local_image with webUrl
- Studio RPC cancellation > Editor error data survives the wire and reaches shared tool output without retry
- Studio RPC cancellation > aborting a tool call closes its pending Studio socket
- Studio RPC cancellation > direct RPCs isolate overlapping roots and children without leaking identity after the run
- Studio RPC cancellation > session metadata remains stable across separate TCP calls
- Studio RPC cancellation > surfaces a structured Studio rejection reason without dropping its data
- Web server extraRoutes hook > /health is never shadowed
- Web server extraRoutes hook > a server built without the hook keeps its previous behavior
- Web server extraRoutes hook > persisted image routes are never shadowed
- Web server extraRoutes hook > routes matching the hook reach it, including async handlers
- Web server extraRoutes hook > the request method and body reach the hook intact
- Web server extraRoutes hook > unmatched paths fall through to the server's own handling
- Web server persisted image route > rejects traversal attempts outside persisted image root
- Web server persisted image route > returns 404 for missing persisted images
- Web server persisted image route > serves persisted images with image headers
- analytics onStop > sends usage to Bubo /studio-log with Hub token auth
- app branding respects VITE_APP_PROJECT_NAME
- bundled tool input schemas > every tool advertises an object schema with no top-level union
- loads model from config.jsonc and returns required fields

The sidecar schema failure identifies `studiorpc_proceduralmodel_run`, not either image tool. The unnamed failures are local Studio listener setup timeouts. Full logs remain in `/tmp/world-thumbnail-root-tests.log` and `/tmp/world-thumbnail-sidecar-tests.log`.


### PR delivery on 2026-10-27

The user subsequently requested a new branch, commit, push, and PR. The final changes were isolated from the original dirty checkout into `feat/world-thumbnail`, based on `origin/main` at `2f1c2bc08d9b4ce26eeec996462c240fb09c453c`. The previously required file/folder link feature was already merged as PR #490. The current main skill inventory was preserved while adding world-thumbnail.

Fresh checks on the PR branch:

- `bun run lint`: passed (8 informational diagnostics).
- `bun run typecheck`: passed.
- Root `bun test`: 2,805 passed, zero failed.
- Sidecar image-generation suite: 40 passed, zero failed.
- Bootstrap skill manifest suite: 4 passed. Skill quick validation passed.
- Sidecar full suite with its SVG preload: 1,460 passed, 50 failed. A comparison run with the feature changes removed produced 1,454 passed and the identical 50 failures; there were no new failures. These failures include existing procedural-model schema, shared RPC mock contamination, and app-branding behavior. The six added thumbnail tool cases all pass.
- The skill text was trimmed conservatively from 79 to 67 lines, retaining all requested requirements while removing repeated tool implementation details and link examples.
