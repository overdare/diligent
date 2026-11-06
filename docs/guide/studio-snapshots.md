# Studio snapshots

Studio snapshots save the complete `.ovdrjm` map document, including its instances and scripts. They do not back up `.umap` files, external assets, or other project files. The OVERDARE bundled tools expose the same behavior through the shared runtime used by Web and TUI.

## Capture and restore

| Tool | Behavior |
| --- | --- |
| `studiorpc_snapshot_create({})` | Save Studio and create a manual checkpoint; its label is generated internally. |
| `studiorpc_snapshot_list({})` | List checkpoint IDs, request IDs, labels, capture times, kinds, and state summaries. |
| `studiorpc_snapshot_context({ snapshotId })` | Inspect saved map data and its summary; optionally include the originating conversation. |
| `studiorpc_rollback({ snapshotId })` | Restore a specific checkpoint. Omit the ID to restore the latest automatic pre-edit baseline. |

For example, ask the agent to "Save a checkpoint of the working lobby before changing the spawn system." It can later use the list and context tools to recall that checkpoint's state without rolling back.

An automatic `turn` snapshot is captured once, immediately before the first map-editing tool in a user request. Sending a prompt or finishing a turn does not itself create one. Capture calls `level.save.file`, requires `success: true`, and then copies the saved map while holding the project's Studio write lock. Concurrent first edits share the same capture attempt. A failed save or copy produces a warning; editing retains its existing behavior, and the baseline is not retried after edits begin.

Tools inherited by background child agents retain the parent request that spawned them, including nested children. A later parent prompt therefore cannot relabel the child's checkpoint as belonging to that new request. Completed main turns release their cached state; active child tools keep their captured request reference.

A `manual` snapshot captures the moment the create tool runs, with no input parameters. It initially uses the label `Manual checkpoint`. When a model is available, the existing background summary request generates a short label together with `stateSummary`; if generation fails or is unavailable, the fallback label remains. Automatic snapshots retain the original user request as their label. Several manual checkpoints can belong to the same request. They survive automatic cleanup and do not replace the parameterless rollback target. Automatic cleanup keeps the latest 20 automatic/safety snapshots per session; manual checkpoints are excluded.

Rollback also verifies saving before starting, preserves the discarded state in a `pre-rollback` safety snapshot when possible, and then restores/applies the chosen map. Safety snapshots remain selectable by ID, so a rollback can itself be undone. Snapshot capture and map writes share a project lock within a provider instance; separate sidecar processes are not coordinated by that lock.

Capture prepares temporary files and publishes metadata before exposing the final map copy. Interrupted or failed publication therefore cannot expose a manual or safety checkpoint as an automatic snapshot with missing metadata. Background summaries replace metadata atomically, preserving the previous record if replacement fails.

## Identity and storage

Project storage contains `sessions/<sessionId>.jsonl` and `snapshots/<sessionId>_<index>.ovdrjm`, with a matching `.json` metadata file. The storage root follows the configured namespace (`.overdare` in production, `.overdare-dev` for the OVERDARE development host, `.diligent` by default).

`userMessageId` is the session JSONL entry's `id` where `type` is `message` and `message.role` is `user`. The runtime allocates it before prompt hooks and uses the same value for live events and persistence, even if a hook augments the prompt. Snapshot metadata stores that ID and `transcriptPath`. With `includeConversation: true`, context lookup opens that transcript and matches the exact ID; a missing match is reported explicitly. Legacy snapshots without a message ID retain their prompt/time lookup.

The snapshot `id` is the filename stem `<sessionId>_<index>` and remains separate from `userMessageId`: one request can own several checkpoints. `index` starts at zero and each capture uses one more than the highest existing map or metadata index for that session. An interrupted capture can leave an unused metadata-only ID, so indexes need not be consecutive. It is not a transcript line number. `userMessageId`, `label`, and `stateSummary` live in the matching `.json` metadata, not in the filename. `rollback` and `snapshot_context` select by snapshot ID.

Explicit ID lookup checks only `<snapshotId>.ovdrjm` and reads its matching `.json`, without enumerating the directory or loading the map contents to locate it. IDs must be a single filename; Unix/Windows path separators, drive/stream separators, and NUL are rejected before file access. Metadata without a committed map is unavailable. Legacy metadata fallback and summary status normalization are shared with list results. Listing snapshots and selecting the default rollback baseline still enumerate the directory.

## Inspect a saved map

`snapshot_context` reads the selected `.ovdrjm` copy directly, without saving, restoring, or contacting Studio. It works when Studio is offline or the live map has changed or been removed. UTF-8 and BOM-prefixed UTF-16 maps are supported. Its JSON result contains `snapshot` metadata (including any state summary), a `data` page, and an optional `conversation` excerpt.

```typescript
// Browse the saved hierarchy and find instance GUIDs.
studiorpc_snapshot_context({ snapshotId: "session_3" });

// Read properties from a saved instance, excluding script Source.
studiorpc_snapshot_context({ snapshotId: "session_3", view: "instance", guid: "instance-guid" });

// Read the original script text from that snapshot.
studiorpc_snapshot_context({ snapshotId: "session_3", view: "script", guid: "script-guid" });

// Include the request that led to this snapshot and nearby conversation.
studiorpc_snapshot_context({ snapshotId: "session_3", includeConversation: true });
```

The default `tree` view returns a flat preorder hierarchy with GUID, name, class, parent GUID, depth, and child count. An optional `guid` limits it to that saved subtree, with depth relative to the subtree root. Name and class previews are limited to 200 characters; GUIDs are preserved. `instance` and `script` views require a GUID from the saved map. Instance `content` is formatted property JSON; script `content` preserves the original Source text, including line endings. No instances, scripts, or external assets are executed or loaded into Studio.

`offset` starts at zero. Tree pages default to 50 nodes and cap larger requests at 200; property/script pages default to 4,000 characters with a maximum of 8,000. Character offsets count JavaScript UTF-16 code units. Responses also respect a byte budget, so a page can be shorter than `limit`. Continue with the returned `data.nextOffset` until absent, keeping the same snapshot, view, and GUID. Concatenate property `content` pages before parsing their JSON; concatenate script pages to reconstruct the exact source. `data.total` reports the total node or character count.

Conversation lookup is off by default. When requested, it returns the linked user message plus up to four following text entries, each capped at 500 characters, stopping before the next user request. It does not run a separate LLM analysis: the calling agent interprets the excerpt. Messages following capture can describe later changes and are not evidence of the saved map state. An unreadable transcript does not prevent map inspection. An unreadable or invalid snapshot map returns `dataError` while retaining metadata and any requested conversation when they fit the output budget.

### Compare two saved maps

Use `view: "diff"` to compare the complete saved before/after maps without a live-world Lua dump, a property
whitelist, a model request, or a custom audit script:

```typescript
studiorpc_snapshot_context({
  snapshotId: "session_3",
  compareToSnapshotId: "session_4",
  view: "diff",
  limit: 50,
});
```

`snapshotId` is the before state; `compareToSnapshotId` is the after state. Diff is map-wide and rejects `guid`.
The comparison ID is rejected on other views. Both IDs use the same safe direct lookup as ordinary context reads.
Capture an after checkpoint with `studiorpc_snapshot_create({})` when needed; comparison itself never saves or
changes Studio.

The response includes metadata for both snapshots and a `data` page:

- Global `counts` distinguish added, removed, changed and unchanged instances. `total` counts changes, not instances.
- Rows are sorted by stable GUID. Before/after identities distinguish name, class and parent changes.
- `changedProperties` covers all stored properties, including `Enabled`, transforms and read-only/unknown properties.
  Derived caches can therefore appear as changes; the tool does not silently dismiss them as harmless.
- `Source` changes use SHA-256 of the exact saved text, including line endings. Source bodies are never included.
- `ActorGuid`, `ObjectKey`, `InstanceType`, `LuaChildren`, `Name` and `Parent` are separated from stored properties.
  Identity/hierarchy changes use GUID, name, class and actual tree parentage; object keys and child ordering are ignored.
  Property object-key order is ignored, but array order, value types and missing values remain significant.

Pages default to 50 changes and cap larger requests at 200, within the same 40,000-byte response budget.
Follow `data.nextOffset` with both IDs and `view: "diff"` unchanged. Global counts remain the same on every page.
An empty out-of-range page is not a clean diff: check `total` and `counts`. Missing/duplicate GUIDs, malformed
hierarchies, invalid maps and a single change too large to fit return an explicit error, not a preservation pass.

This compares saved `.ovdrjm` documents only. It cannot prove external asset preservation, runtime correctness,
visual/audio acceptance, or which changes were authorized. Inspect the changed rows against the requested scope;
use the instance/script views on either snapshot for values or source text.


## State summaries

New automatic, manual, and safety snapshots have `summaryStatus` in metadata:

- `pending`: a background model request is in progress.
- `ready`: `stateSummary` contains the AI-generated description.
- `failed`: generation or metadata update failed; the snapshot remains usable.
- `unavailable`: the integration did not supply a model capability.

The background request uses the session's selected model and existing runtime authentication with no tools. It reads the immutable snapshot copy, never the current map or the requested future change. The input is limited to 30,000 map characters, output to 400 tokens/2,000 characters, and the request has a 30-second timeout. The prompt requires summaries of truncated input to describe their limited evidence and forbids claims of runtime validation. These summaries are descriptive model output, not gameplay test results.

List/context results expose summaries when ready, including when the original transcript is missing. Generation failure does not block editing or restore. No historical summary is generated automatically for legacy snapshots. List/context report pending summaries older than one minute as failed, including work interrupted by process shutdown; there is no durable background job queue or automatic retry.

Standalone MCP tool contexts have no Diligent user message or selected model. Manual snapshots still work there, with no user-message link and `summaryStatus: unavailable`.
