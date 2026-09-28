# Studio change summaries

The owning OVERDARE sidecar collects project edit logs immediately on startup
and approximately once per second into a shared, bounded RAM journal. Collection
continues while models are working, independently of delivery. No database,
archive files, or cursor files are created. Existing disk archives are left
untouched and are not used by the new detail tool.

## Session delivery and authorship

Each actual session has an independent RAM sequence marker. Collection deletes
complete, ingested source files without waiting for every session to read them;
another session's unread changes remain in the journal until bounded eviction.
Abandoned sessions never prevent cleanup. Marker state survives tool recreation
in the same process, not process restart.

One bounded automatic summary is injected at the start of each main user request.
The marker advances only after the runtime accepts it into conversation context.
Web and TUI receive the same presentation. Child agents do not automatically
inject summaries; they can query explicitly without advancing their main's marker.
New edits during a request are available through explicit queries or the next
request's automatic summary.

Studio RPC requests carry the actual executing session ID in optional top-level
`meta.sessionId`, including child IDs. The runtime resolves the root group from
persisted ancestry, not the last main prompt. Explicit `Origin.Kind: "mcp"`
records from the querying session, its main, or known descendants are excluded.
Other groups' edits remain visible. Unknown, mixed, legacy, and unregistered
authors remain visible rather than being guessed. Studio must already emit
origin metadata; this change does not modify Studio's logging schema.
External MCP calls without runtime identity do not inherit a main's identity.

## Automatic context budget

One budget covers every section, attribution, counts, warnings, and detail
instructions. The renderer targets 6,000 UTF-8 bytes with an 8,000-byte ceiling.
These approximate 1,500 and 2,000 tokens, not tokenizer guarantees.

- At most 20 objects receive details across sections.
- Each object shows at most four properties and three list items per property.
- Names, property names, and displayed values are limited to 80 characters.
- Script source events, removals, parent moves, and identity/reference changes
  take priority over bulk additions and ordinary properties.
- Repeated scalar edits collapse to first-before and final-after. Fully reverted
  scalar and parent edits disappear, but script edit events remain visible.
- Created-then-removed objects are counted by type. All section counts remain
  complete even when details are omitted.
- Output stops at object boundaries and reports omission counts.

These summaries are collected history, not an agent-relative diff. Compare them
with expected work and inspect affected instances before editing.

## Explicit queries and temporary details

`studiorpc_studio_changes({})` refreshes collection and reports retained
transactions not yet returned to this session. A successful new query advances
only that marker; invalid queries and detail reads do not. Repeated queries
without edits return no changes. Identical transactions appended later remain
distinct occurrences. Recreating the live log does not reset a session marker.

Summaries include a temporary `batchId`. Retrieve paginated detail rows with:

```json
{
  "view": "details",
  "batchId": "<batch ID from the summary>",
  "guid": "<optional instance GUID>",
  "changeType": "modified",
  "offset": 0,
  "limit": 20
}
```

`changeType` accepts `added`, `addedThenRemoved`, `removed`, `moved`,
`modified`, or `sourceChanged`. Supplying a filter or batch ID also selects
detail mode. Follow the returned continuation offset with the same batch ID.
Details default to this consumer's latest retained batch, not another session's.
IDs refer to fixed journal ranges and are restricted to their consumer. Partial
eviction or restart expires the batch explicitly; there is no latest-batch
fallback for an explicit expired ID and no archive path. Script source content
is not logged: read the current script when source events are reported.

## Retention, source safety, and recovery

Default internal limits are 16 MiB encoded journal payload and 10,000 records;
4,096 consumer markers and identities each; 256 detail descriptors and file
retry entries; an 8 MiB input read, 64 MiB recognized source backlog, and four
processed files per poll. Encoded bytes and entry counts bound retained logical
data, not exact process RSS; JavaScript objects and transient parsing use more.
Oldest journal records are evicted regardless of unread markers. Only inactive
markers and identities may be replaced; all-active capacity is rejected.

The single owner rotates only recognized regular `Edit.Log` files and its
recognized rotation names, never arbitrary `*.consuming` files or symlinks.
Complete transaction prefixes are appended once; unfinished UTF-8/UTF-16 tails
stay on disk for retry. Delete failures retry cleanup without duplicating the
already-ingested prefix. Oversized sources/backlogs may be deliberately dropped
with a visible history-gap notice.

RAM-only means process exit, restart, or bounded eviction can lose undelivered
changes. Resumed sessions and missing/expired history receive a gap warning,
including when no edit survives. Inspect current Studio state before continuing;
do not assume remembered state is current. The collector stops its timer and
awaits an in-flight poll during normal shutdown or failed host startup.
`STUDIO_DISABLED` hosts do not start it. Standalone MCP tool creation does not
start a polling timer, although explicit queries refresh the shared collector.

This supports multiple sessions in one owning process. Independent processes
against the same project do not share RAM or markers; cross-process broadcasting
is not implemented. Studio is assumed to reopen its log per finalized transaction.
