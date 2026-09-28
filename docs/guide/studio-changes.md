# Studio change summaries

The OVERDARE Studio tool provider collects the project edit log once at the start
of each user request. Its shared agent hook injects one bounded summary for the
main agent. Web and TUI receive the same context presentation; child agents do
not independently inject it. There is no automatic polling during a request.

## Automatic context budget

One budget covers every section, attribution text, counts, and detail instructions.
The renderer targets 6,000 UTF-8 bytes and stays below an 8,000-byte ceiling.
These are conservative approximations of 1,500 and 2,000 tokens, not tokenizer
guarantees. A future mid-request injection must share this request's budget,
rather than allocate a fresh budget per loop iteration.

- At most 20 object/session entries receive details across all sections.
- Each object shows at most four changed properties. Each list property shows
  at most three changed items across additions, removals, and modifications.
- Names, property names, displayed values, and session headings are limited to 80 characters.
- Changes are grouped under `Session: <ID>`, followed by change-kind sections
  such as Added, Modified, and Removed. Missing IDs, legacy records, and ambiguous
  non-MCP origins are collected under `Session: unknown`.
- Aggregation is scoped to both session and object. A create in one session and
  a delete in another remain separate, as do opposite property edits by different
  sessions. Each session's counts include all its collected changes.
- At most three session groups are displayed, ranked by their most critical
  change. Omitted groups are counted and remain available through archived details.
  `Total changes` and `Totals` cover every session, including omitted groups. Web
  uses the complete total for its badge; TUI receives the same summary text.
- Script source edits, deletions, parent moves, and identity/reference edits take
  precedence over bulk additions and ordinary property changes.
- Repeated scalar edits collapse to the first value and final value. Reverted
  scalar and parent edits disappear from the summary. Equality is checked on
  complete values before display truncation; script edit events remain visible.
- Objects created and subsequently removed are counted by type rather than
  individually listed. All section counts remain complete even when object
  details are omitted, preserving the Web notice's count contract.
- Output stops at object boundaries and reports omission counts.

Only explicit origin metadata identifies a session. Legacy records may include
this agent's own work and are not a diff against an agent-relative baseline.

Every Studio RPC request includes the top-level `meta.sessionId` field. The
executing agent supplies its session ID through `ToolContext`, including child
agents that share their parent's tools. An asynchronous execution context carries
the ID through nested helpers, awaits, and write-lock waits. Standalone MCP and
background calls without an agent ID use a stable `sidecar-...` process identity.
Separate sidecar processes receive separate identities. If Studio records `Origin.Kind` as
`mcp` and `Origin.SessionId` matches that ID, automatic summaries and detail
queries exclude the record. Other sessions, legacy records without origin
metadata, and `unknown` or `mixed` origins remain visible. Archives retain all
parsed records, including this agent's own edits. Studio builds that do not
record origin metadata continue to report changes as before. External MCP calls
use their sidecar identity for filtering; it does not identify an external
client's individual agent transcript. Both summaries and archived detail pages
identify the remaining records' session groups. Full IDs remain in the raw archive
when display labels are truncated or omitted.

## Follow-up reads

`studiorpc_studio_changes({})` reports live transactions not yet returned by this
tool, excluding the delivered turn-start summary. Repeated calls without edits
return the no-changes message. Identical transactions appended later still count
as new occurrences. Cursors and automatic turn caches are scoped to the executing
session, so a child query cannot suppress a parent's report. A new user request
or recreated live log resets that session's cursor.
Queries do not rotate or delete Studio's live log, so the next request can still
collect that batch.

The automatic summary and live query results include a `batchId`. Request
archived details with:

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

`changeType` accepts `added`, `addedThenRemoved`, `removed`, `moved`, `modified`,
or `sourceChanged`. Supplying a filter or batch ID also selects detail mode.
Detail pages contain individual property/list-item rows, so objects with more
than four properties remain fully queryable. The page can contain fewer than
`limit` rows to respect the shared byte budget; follow the returned continuation
offset. Specify the same batch ID to keep pagination stable while Studio edits
continue. Details default to the most recent queried or captured batch; without
one, the tool snapshots the live log or reads the latest local archive.

Details also provide the archive path for inspecting complete values through a
bounded file read. Archives contain all parsed transactions and are saved under
the project's storage namespace, for example `.overdare/logs/studio-changes/`.
They remain available after tool recreation and process restart. Query cursors
are process-local, so restarting a tool may report the live batch again.

The turn-start collector durably writes an archive before deleting rotated log
files. Failed archival leaves those files for a later retry. Archives are local
diagnostics and are not automatically pruned. The engine does not log script
source content; source events instruct the agent to read the current script.
