# Autonomous Asset and Pack Selection Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task in the current session. Steps use checkbox syntax. Implementation and verification completed on 2026-10-01; see the execution record below.

**Goal:** Let the main LLM select and import suitable assets or pack members without a mandatory picker, using descriptions and actual thumbnail images when needed.

**Architecture:** OVERDARE's bundled RAG tools return candidates to the existing agent loop. An explicit `requestUserInput` option opens the existing shared user-input flow. Extend the product-owned deep-search tool for pack enumeration and thumbnail inspection; reuse existing image output, import, and placement contracts.

**Tech Stack:** Bun, TypeScript, Zod, existing Diligent tool contracts, React Web, terminal TUI.

**Spec:** The design brief below and [OVDR-15486](https://overdare.atlassian.net/browse/OVDR-15486), under OVDR-10868 (asset loading and import).

**Branch:** `feat/ovdr-15486-autonomous-asset-selection`, based on `origin/main` at `e8ca70f4`.

## Design brief

The reported problem is that asset search blocks on user selection even when an agent is running unattended. The user requested autonomous asset and pack selection based on description or image information. The supplied discussion proposes a `requestUserInput` boolean so the LLM can decide whether to offer a picker.

Proposed behavior:

- `overdaresearch(source="assets")` defaults to `requestUserInput=false`. It returns candidates and detected packs; the main LLM chooses which IDs to import. Search does not automatically choose the highest-ranked item, including a single match or Audio/Animation/Effects/UI assets.
- Replace `selectable` with `requestUserInput` in the exposed tool schema and migrate repository callers, tests, and instructions. Historical tool records remain readable as history. Do not keep the old instruction prohibiting autonomous placement choices.
- Always request `includePacks=true` for asset search. Return packs even if there are no visible asset results. Do not automatically enumerate every detected pack.
- Candidate data includes `assetId`, `title`, `description`, `imageUrl`, score, keywords, and classification. Derive description from the catalog text's visual prose; map existing thumbnail aliases to `imageUrl`. Keep the original `text` field for compatibility with informational consumers. Omit a missing image URL rather than inventing one.
- `requestUserInput=true` offers a picker whenever any asset or pack is available, including one candidate and the previously auto-selected categories. Use the existing asset tiles and pack text rows. Add `None of these are suitable` as a text option with reserved value `none`.
- Return distinct selection outcomes: `selected`, `none`, `cancelled`, and `custom`. Empty answers are cancellation. A known asset ID or offered pack value is selected. Unrecognized/free-text answers are feedback, never an asset ID or pack keyword to import.
- Selecting a pack returns its member palette as today. Autonomous selection uses `overdaresearch_deep(action="asset-pack", packKeyword=...)` to obtain the same palette without asking a user. The LLM selects only the members needed for the request.
- `overdaresearch_deep(action="asset-preview", urls=[...])` fetches one to four catalog thumbnails and returns actual `outputImages` with URL-to-image-index mapping. An image URL or a UI gallery alone does not mean the model has inspected the image.
- The LLM may retry search, compose from other assets, or proceed without an asset when candidates are unsuitable. It may ask the user by setting `requestUserInput=true`; uncertainty must not unconditionally trigger a picker through code or prompt rules.

Search, pack enumeration, and preview are discovery operations. Existing import tools perform mutations and retain their current approval behavior. This work does not add asynchronous questions, timeout-based selection, a new global autonomy setting, or changes to yolo policy.

### Why this approach

Changing only the picker default would leave autonomous pack selection unavailable and thumbnails absent from model-readable results. Fetching all images and pack members on every search would add unnecessary latency and context. Returning metadata first and exposing explicit follow-up reads supports both independent execution and deliberate user selection.

## Current evidence

- `sidecar/src/tools/rag/overdaresearch.ts` currently defaults `selectable` to true, forbids autonomous placement selection in its schema description, restricts pack detection to that path, and has category-specific top-result selection.
- `normalizeAssetResult` strips image aliases; `render.ts` separately normalizes them for UI only. Pack enumeration currently exists only inside the picker path.
- `sidecar/src/tools/rag/overdaresearch-deep.ts` currently supports `origin-file` only. Preserve that request and result contract.
- `packages/runtime/src/tools/read-image.ts` reads local files. It does not inspect a remote thumbnail URL.
- Existing `ToolResult.outputImages` reaches the provider image adapters. Reuse this path; no new model invocation or provider-specific selection algorithm is needed.
- A read-only live `subway` search on 2026-10-01 returned HTTP 200, catalog text, `thumbnailUrl`, and multiple packs. The returned thumbnails used `https://asset-prod.cdn.overdare.com/images/world-asset/raw/live/...`. This is evidence of the endpoint shape, not a fixture assertion about particular IDs or pack sizes.

## Global constraints

- English only in tracked files; Jira descriptions may be Korean.
- Tests live under package-level `test/` directories; strengthen tests before changing behavior.
- Selection behavior belongs in the bundled product tool, with Web and TUI consuming the same input and render contracts.
- Reuse `outputImages` and existing import/placement tools. No new generic protocol method or provider adapter is planned.
- No implicit top-score selection and no automatic bulk import of a pack.
- Keep unrelated local files untouched. Keep this branch independent of the Studio change collector branch.

## Review focus

- A pack-only response is useful discovery data even when the asset results array is empty.
- Missing descriptions/images must not discard valid catalog IDs or cause an automatic picker.
- User free text and `none` must not be interpreted as importable IDs; cancellation remains distinct.
- A failed image must preserve the other preview results and the text-based selection path.
- Large packs must retain every member while avoiding automatic download or import of the whole collection.

## Task 1: Return candidates and make user selection explicit

**Modify:**
- `apps/overdare-ai-agent/sidecar/src/tools/rag/overdaresearch.ts`
- `apps/overdare-ai-agent/sidecar/src/tools/rag/render.ts`

**Tests:**
- `apps/overdare-ai-agent/sidecar/test/tools/overdaresearch-select.test.ts`
- `apps/overdare-ai-agent/sidecar/test/tools/overdaresearch-pack.test.ts`
- `apps/overdare-ai-agent/sidecar/test/tools/rag.test.ts`
- `apps/overdare-ai-agent/sidecar/test/tools/rag-render.test.ts`

**Interfaces:** Default asset output is `{ results: AssetCandidate[], totalCount: number, packs: PackInfo[] }`. A candidate preserves the existing fields and adds `description: string` and optional `imageUrl: string`. Picker output adds `metadata.selectionStatus` and a selected `metadata.assetId` or `metadata.packKeyword` only for an offered selection.

- [x] Extend the existing synthetic fixtures to include text containing a visual description and both `imageUrl` and `thumbnailUrl` variants. Use the existing `searchTool` and fetch mocks.
- [x] Write a regression for the default path and explicit false: assert `ask` count is zero, both asset IDs remain in `JSON.parse(result.output).results`, descriptions and canonical image URLs survive, packs survive, and the RAG request includes `includePacks=true`.

```ts
const args = tool.parameters.parse({ query: "katana", source: "assets", topK: 8 });
expect(args.requestUserInput).toBe(false);
const result = await tool.execute(args, ctx);
expect(asked).toBe(false);
expect(JSON.parse(result.output)).toMatchObject({
  results: [{ assetId: "111" }, { assetId: "222" }],
  packs: [{ keyword: "pack_weapons", memberCount: 12 }],
});
expect(result.metadata?.assetId).toBeUndefined();
```

- [x] Cover default one-match and Audio/UI cases returning candidates rather than a selected result. Cover empty text with a valid ID, missing thumbnail, zero assets with multiple packs, and zero assets/zero packs. Preserve docs search and approval rejection tests.
- [x] Write explicit-true tests for one/many assets and pack-only responses. Assert the offered values include `none`; choosing it returns `selectionStatus="none"` without an asset ID. Empty answers return `cancelled`; arbitrary text or an unoffered `pack:` value returns `custom` without enumerating a pack.
- [x] Run the four affected test files and confirm the changed-default regressions fail for the intended reason.
- [x] Replace the old flag and remove category-specific automatic selection. Normalize model-visible candidate metadata using the same image alias rules as the gallery. Keep UI gallery generation. Build the explicit picker only when requested, validate its answers against offered values, and preserve existing single-asset success text.

```ts
requestUserInput: z.boolean().default(false).describe(
  "Assets only. Set true to offer the user an asset or pack picker. " +
  "Otherwise read the candidates and choose suitable assets yourself."
)
```

- [x] Run those tests to green, search repository references to `selectable`, and migrate active callers/instructions rather than rewriting historical plans.

## Task 2: Expose pack enumeration without a picker

**Modify:** `sidecar/src/tools/rag/overdaresearch.ts`, `sidecar/src/tools/rag/overdaresearch-deep.ts`.

**Create:** `apps/overdare-ai-agent/sidecar/src/tools/rag/asset-catalog.ts` for shared member enumeration and candidate normalization; `apps/overdare-ai-agent/sidecar/test/tools/overdaresearch-deep.test.ts` for deep action behavior.

**Interfaces:** Export `enumeratePack(keyword: string, signal: AbortSignal): Promise<AssetCandidate[]>`. Both selected-pack and deep-pack paths return `{ pack: string, memberCount: number, members: AssetCandidate[] }`. Deep action `asset-pack` requires a nonempty `packKeyword`; it does not require `urls` or a ranking query. Keep the shared RAG endpoint environment override.

- [x] Add failing tests for deep pack enumeration with `assetFilter: { keywords: ["pack_metro"] }`, without a query or user-input call. Assert every synthetic member ID, description, and image URL is present in the result.
- [x] Test empty packs and a synthetic pack larger than search topK. Assert members are neither truncated to topK nor imported. Cover HTTP failure, timeout, and an already-aborted context. Preserve the existing `origin-file` valid request and bucket rejection tests.
- [x] Extract the existing enumeration path into the shared catalog helper, thread context cancellation into it, and use it from both tools. Return the full palette and preserve the existing description clipping behavior.
- [x] Extend the deep action schema and description to document `asset-pack`. Require fields for the selected action and reject incompatible combinations; keep the existing `origin-file` call shape.
- [x] Run select, pack, deep, and provider assembly tests. Assert picker and autonomous enumeration return the same palette for the same fixtures.

## Task 3: Inspect selected thumbnails as real image content

**Create:**
- `apps/overdare-ai-agent/sidecar/src/tools/rag/asset-preview.ts`
- `apps/overdare-ai-agent/sidecar/test/tools/asset-preview.test.ts`

**Modify:** `sidecar/src/tools/rag/overdaresearch-deep.ts`, `sidecar/test/tools/overdaresearch-deep.test.ts`.

**Interfaces:** Export `inspectAssetPreviews(urls: string[], signal: AbortSignal): Promise<ToolResult>`. Deep action `asset-preview` accepts one to four URLs and returns JSON `{ previews: Array<{ url: string, imageIndex?: number, error?: string }> }` and `outputImages`. Image indices address successful image blocks in input URL order, even when a preceding request fails. No preview call imports or asks for selection.

Proposed bounds: HTTPS thumbnails on `asset-prod.cdn.overdare.com`; redirects rejected; five-second request timeout; at most two concurrent downloads; at most 5 MiB source bytes per image and 10 MiB total bytes per call; PNG/JPEG/GIF/WebP only with recognized image headers; reuse `downscaleImageIfNeeded` and enforce the final transport limit. Read response streams with a byte cap rather than relying solely on Content-Length. Do not log base64 data. Return a per-URL error for failure; do not silently manufacture image content. Additional catalog CDN hosts require evidence and an explicit allowlist update.

- [x] Add tiny valid synthetic image fixtures inline. A successful test must decode the returned base64, compare it to the served image bytes, and verify URL/index mapping. This proves tool-owned image propagation rather than model interpretation.

```ts
expect(result.outputImages?.[0]).toMatchObject({
  type: "image", source: { type: "base64", media_type: "image/png" },
});
expect(JSON.parse(result.output).previews).toEqual([
  { url: thumbnailUrl, imageIndex: 0 },
]);
```

- [x] Test unsupported URLs, redirect responses, non-image bytes, chunked oversize data, total-byte exhaustion, timeout, cancellation, and one failed URL alongside successful ones. Assert unsupported inputs are rejected before download and no failure gets an image index.
- [x] Run the preview tests to confirm the missing path fails, then implement bounded fetch, image validation, resizing, and per-item error results. Use the parent context signal in addition to timeout cancellation.
- [x] Add `asset-preview` to the deep schema and route it to this helper. Continue to use existing tool approval hooks. Return render text summarizing loaded/failed previews; reuse existing image output handling in both clients.
- [x] Run preview, deep, and existing image-provider tests if the implementation changes image propagation. Do not modify provider code merely to add this product tool.

## Task 4: Document autonomous import and verify both clients

**Modify:**
- `apps/overdare-ai-agent/bootstrap/skills/asset-pack-import/SKILL.md`
- `docs/guide/tool-rendering.md`

**Tests:**
- `apps/overdare-ai-agent/sidecar/test/web/client/components/question-card-interactions.test.tsx`
- `packages/cli/test/tui/components/question-input.test.ts`

- [x] Add a Web interaction regression with asset tiles and payload-free pack/none rows. Clicking and submitting `none` must preserve its value, and selecting a pack must preserve its `pack:` value. Use the existing QuestionCard DOM harness.
- [x] Add TUI regressions selecting pack and none values through the existing QuestionInput callback; verify cancellation is not submitted as an asset. Change frontend code only if these behaviors fail.
- [x] Update the pack skill: search returns metadata and packs by default; choose a pack, read its palette, optionally inspect a few thumbnails, choose relevant members, and import/place using returned GUIDs. Replace unconditional scale clarification with optional user choice when it helps satisfy the request. Preserve subset/bulk routing and readback verification.
- [x] Update the tool-rendering guide with default autonomous behavior, explicit picker behavior, none/custom/cancelled outcomes, and the distinction between a displayed thumbnail and an image passed to the model.
- [x] Run affected sidecar tools and Web suites, CLI question-input tests, `bun run lint`, `bun run typecheck`, and `bun test`. Follow the repository's suite routing; keep host/client suites in their owning packages.
- [x] In a live agent session, exercise an asset request and a themed scene request without explicitly asking for choices. Record actual tool calls proving no user-input request, candidate/preview evidence, selected IDs, imports, and GUID-based readback. Remove test objects afterward.
- [x] In both Web and TUI, explicitly request choices and verify asset, pack, none, and cancellation paths. Verify a preview failure leaves descriptions available so execution can continue. If a live model unexpectedly opens a picker, inspect the active tool descriptions and loaded skills before changing runtime policy.
- [x] Record unit/contract results separately from observed model selection quality and live import outcomes. Update OVDR-15486 with actual implementation, branch, commits, and any pending verification once work begins.

## Execution record

- Task 1: default discovery and explicit selection tests failed first (13 failures) and passed after implementation (20 tests across selection, pack, provider and render files).
- Task 2: pack/origin/cancellation tests failed first (5 failures) and passed after extraction and routing. Large-palette executor regression failed first and passed with the per-result byte cap.
- Task 3: preview tests failed first (9 failures) and passed with bounded image reads. Final review identified corrupt magic-only image payloads; the corrupt-plus-valid regression failed first and passed after actual image validation.
- Task 4: Web DOM and TUI keyboard interaction tests passed (9 tests). Existing frontend code already preserved asset, pack, none, and cancellation values, so no frontend product changes were necessary.
- Final fresh review: one P2 image-validation finding, fixed and verified with the failing regression; no deferred findings.
- Final repository suite: 2,608 passed, zero failed. Product tool suite and Web suite ran separately because the root suite does not include all sidecar tests. Web: 537 passed, zero failed. Lint and typecheck passed.
- Live main-agent test used the configured ChatGPT model and actual catalog/Studio tools: zero picker requests, one full pack read, five preview images, three imported roots and three GUID readbacks. The roots were deleted and saved, and level browse verified cleanup. The temporary harness initially used an incorrect raw delete parameter; cleanup was repeated using Studio's ActorGuids contract and verified.

### Rulings

- Preserve palette descriptions without duplicate raw text or ranking scores, matching the existing compact palette output. Search candidates still retain raw text. This prevents doubling large pack context; consumers should use description for palettes.
- Set each palette's maxOutputBytes to its serialized size so the actual tool executor preserves valid JSON and every member. Cost: large palettes use more model context; enumeration stays an explicit read.
- Accept null for unused deep-action fields and advertise nullable schemas. A live strict-provider run otherwise fabricated placeholder strings/arrays and repeatedly failed validation. Nonempty fields for the wrong action remain invalid.
- Remote previews support PNG/JPEG/WebP, using the existing validated decoder through the public image contract. GIF is an explicit per-URL failure because the existing decoder cannot validate GIF content. Cost: a GIF-only candidate must be judged from its description or another thumbnail.
- Web and TUI choices were exercised through their real DOM/component and keyboard paths with synthetic requests; manual native-window interaction was not repeated. Actual main-agent selection, image propagation, imports, and readback were verified separately against live services.
