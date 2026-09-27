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

- At most 20 objects receive details across all sections.
- Each object shows at most four changed properties. Each list property shows
  at most three changed items across additions, removals, and modifications.
- Names, property names, and displayed values are limited to 80 characters.
- Script source edits, deletions, parent moves, and identity/reference edits take
  precedence over bulk additions and ordinary property changes.
- Repeated scalar edits collapse to the first value and final value. Reverted
  scalar and parent edits disappear from the summary. Equality is checked on
  complete values before display truncation; script edit events remain visible.
- Objects created and subsequently removed are counted by type rather than
  individually listed. All section counts remain complete even when object
  details are omitted, preserving the Web notice's count contract.
- Output stops at object boundaries and reports omission counts.

The records do not establish authorship. They may include this agent's own work
and are not a diff against an agent-relative baseline.

When the runtime supplies an agent session ID, Studio RPC requests include the
optional top-level `meta.sessionId` field. If Studio records `Origin.Kind` as
`mcp` and `Origin.SessionId` matches that ID, automatic summaries and detail
queries exclude the record. Other sessions, legacy records without origin
metadata, and `unknown` or `mixed` origins remain visible. Archives retain all
parsed records, including this agent's own edits. Studio builds that do not
record origin metadata continue to report changes as before. Direct external
MCP calls without a supplied agent session ID do not exclude any records.

## Follow-up reads

`studiorpc_studio_changes({})` reports live transactions not yet returned by this
tool, excluding the delivered turn-start summary. Repeated calls without edits
return the no-changes message. Identical transactions appended later still count
as new occurrences. A new user request or recreated live log resets the cursor.
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
