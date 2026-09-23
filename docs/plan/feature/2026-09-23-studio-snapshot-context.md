# Studio snapshot context implementation plan

Tracking: [OVDR-15298](https://overdare.atlassian.net/browse/OVDR-15298), under Agent stability (OVDR-13087).

## Agreed behavior

Snapshot IDs remain independent of user message IDs because a request can create an automatic baseline and multiple manual checkpoints. Persist the originating user message ID in snapshot metadata and resolve conversation context by that exact ID. Preserve text/time matching only for legacy snapshots without the ID.

Add a manual whole-level checkpoint tool with a descriptive label. Both automatic baselines and manual checkpoints flush Studio before copying the current `.ovdrjm`; a failed or unconfirmed save must not produce a stale checkpoint. Automatic baseline failures retain the existing visible-warning behavior. Manual checkpoints are excluded from automatic retention and from parameterless rollback target selection. Existing rollback-by-snapshot-ID remains supported.

Generate a short LLM state summary from the immutable snapshot file, independently of editing. Use the selected authenticated model through a runtime-owned, tool-free text capability. Store summary status and text in metadata, expose them in list/context results, and keep snapshots usable when summarization fails or no model is available. Bound the input/output and describe the supplied map evidence rather than claiming gameplay was verified. Do not inject every checkpoint into every turn.

## Implementation sequence

1. Runtime identity and model capability
   - Test that the prompt hook receives the same user message ID as persisted JSONL and protocol events.
   - Generate the ID before running prompt hooks and forward it as `user_message_id`.
   - Bind selected-model text generation and session identity through bundled provider contexts, with tests for authentication/model selection, no tools, output/error/cancellation behavior.
2. Snapshot metadata and lookup
   - Add `userMessageId`, manual kind, summary text/status fields.
   - Test exact ID lookup with repeated/changed prompts, missing IDs without guessing, legacy fallback, metadata listing, and retention excluding manual checkpoints.
   - Keep existing snapshot IDs and old on-disk files compatible.
3. Verified capture and manual tool
   - Test that Studio save precedes the copied bytes, an unconfirmed save creates no snapshot, and concurrent first edits capture once.
   - Add `studiorpc_snapshot_create({})` with an internally generated label, approval, serialized save/copy, and a returned snapshot ID.
   - Scope turn state to its session; preserve warnings without relabeling later edited state as an original baseline.
4. State summaries
   - Test that delayed summaries consume copied snapshot bytes even after the live map changes, never block edits, and do not recreate deleted metadata.
   - Bound and sanitize map evidence, summarize through the runtime capability, and persist ready/failed/unavailable status.
   - Show state summaries even when the original transcript is missing; distinguish captured state from subsequent conversation.
5. Verification and documentation
   - Run focused runtime/e2e/Studio tests, affected TypeScript checks, formatting, and the repository test command.
   - Document storage, ID mapping, manual capture, retention, save failures, summary limitations, and shared Web/TUI tool behavior.

## Scope and review checks

- The saved artifact remains the full `.ovdrjm`, not a `.umap`/asset/project backup.
- Studio save failure must never be represented as a successful fresh snapshot.
- Multiple checkpoints in one user request must not overwrite each other.
- The original request ID must survive prompt augmentation and tool-set recreation.
- Background summary completion must not resurrect a pruned checkpoint or overwrite other metadata.
- Legacy snapshots remain restorable and readable; missing exact message IDs must not silently match a different request.
- Model calls use the runtime's credentials; model-less integrations report unavailable summaries explicitly.
- Product tools use existing generic tool presentation in both Web and TUI, with no new client-only protocol.

## Progress

- [x] Runtime identity and model capability
- [x] Snapshot metadata and exact context lookup
- [x] Verified automatic/manual capture
- [x] Background LLM summaries
- [x] Documentation and verification

## Verification results

- Changed runtime, e2e, and Studio test files: 307 passed, 0 failed.
- Studio socket/validation/v2 and WebSocket transport tests outside the socket-restricted sandbox: 54 passed, 0 failed.
- Full repository TypeScript checks and formatting of changed files passed.
- Full repository suite in the sandbox: 2,490 passed, 9 failed (local listeners, filesystem permissions, OS keyring). The unmodified HEAD copy reproduces the same 9 failures (2,485 passed).
- Full sidecar suite in the sandbox: 1,051 passed, 18 failed, 2 hook errors. The unmodified HEAD copy reproduces the same 18 failures and 2 errors; they concern local listeners and Web test configuration/branding isolation. The three affected Web test files pass separately (11 tests).
- Real Studio and live-model smoke tests were not performed; Studio RPC and model generation were exercised with deterministic fakes/local test servers.

Review also identified inherited child tools outliving a parent request. A runtime-owned opt-in tool-fork hook now freezes Studio request context at inheritance, including nested children and later decorators. Main-turn cleanup drops cached session state while active children retain their original reference. Summary reads are asynchronous and bounded; pending summaries older than a minute are exposed as failed on reads after interrupted generation.

Follow-up: removed the manual creation tool's `label` parameter. Manual checkpoints start with a fallback label and generate their short title together with `stateSummary` in the existing background request. Failed/unavailable generation preserves the fallback. Automatic request labels remain unchanged.

## Approved extension: inspect saved map data through snapshot_context

- Extend the existing tool instead of adding a separate snapshot reader. The default `tree` view returns paged hierarchy from the immutable saved file; `instance` and `script` views select an instance by GUID and return paged property JSON or exact Source text.
- Keep `snapshotId` as the selector. `guid` selects a tree subtree or the required instance/script target. `offset` is zero-based; `limit` bounds nodes for tree pages and characters for property/source pages. Responses identify their units and next offset explicitly.
- Return snapshot metadata and data in structured JSON. `includeConversation` defaults to false; when enabled, use the existing exact message ID/legacy matching logic. Report file/target errors explicitly while preserving available metadata and optional conversation.
- Read only the stored snapshot path, support UTF-8/UTF-16, and never invoke Studio save/apply/read RPC or modify the working map. Existing generic Web/TUI tool output is sufficient.
- First add tests covering immutable data, hierarchical/targeted reads, pagination, optional conversation, malformed files, unknown IDs and UTF-16. Implement the reader and context integration independently, then update guide/examples and run affected tests/type checks.

Extension completed. Context returns saved hierarchy, property JSON, or exact script source from the stored path. Conversation lookup is opt-in. Page responses shrink when necessary to stay below the runtime output truncation threshold, preserving continuation offsets. Tree requests use the public flat parameter schema and cap large limits at 200 nodes.

Extension verification: 138 tests passed across the snapshot reader/context, checkpoint, summary, rollback, human-edit, and Studio provider suites. Sidecar TypeScript and changed-file Biome checks passed. Regression fixtures cover changed/deleted live maps without RPC, Unicode and escaped-source output limits with lossless continuation, legacy/exact transcript lookup, and schema-valid large tree limits. No live Studio or model is needed for these read-only operations.

Delivery verification on `feat/ovdr-15298-snapshot-context`, based on `origin/main` at `4368a4c5`: all 336 affected tests passed across 13 Runtime, E2E, and Studio files. The working patch was preserved exactly when moving from the earlier model-feature branch to the current main baseline.
