# Session issue reporting

The OVERDARE `session-issue-report` skill judges whether an observed problem merits a report and calls the
`agent_report` tool. It classifies reports as `agent_failure`, `studio_bug`, or `feature_request` and writes a
structured payload: title, task context, problem, report reason, suggestion, optional suspected cause, and evidence.
The cause is free prose, not an enum. It should remain absent when the evidence does not support an explanation.

The existing `issue-report` experiment owns both the skill and tool and defaults to OFF in every release channel.
Users can enable it through Config → Experiments → Internal issue reporting. Existing explicit overrides are
preserved. Reporting also requires telemetry consent; turning the experiment on does not bypass consent.

## Runtime-owned context

The Gateway provider supplies the executing session ID, project ID, latest observed sequence, timestamp, working
directory, optional runtime version, and up to five short execution records. It retains context separately for each
session and rejects conflicting attribution. Reports use the same project attribution as session telemetry. Before
any entry exists, an explicitly configured project is sufficient; without either source, reporting is unavailable.
The tool never scans the filesystem for a session or asks the model to supply identities or authentication.

The append observer retains only binding metadata: user/project identity, durable sequence and the exact transcript
path supplied by the runtime. It does not build or maintain a report-excerpt cache. Only when `agent_report` is
executed does the tool open that bound session's JSONL file, verify its header identity/version, and stream entries
through the observed durable sequence. It never chooses the newest file or guesses another session's path. Later
incomplete writes are outside that snapshot. The read is cancellable and limited to two seconds; missing, invalid or
incomplete bound files fail the report without falling back to cached or unrelated evidence. A changed transcript
path invalidates that session's binding; identity and path are rechecked after reading and immediately before sending,
including after asynchronous token resolution.

During that request only, a temporary working set keeps the latest 50 execution candidates. User placeholders,
assistant prose and skill-loading/reporting traffic do not count. Calls retain tool names and short masked
arguments; results retain explicit success/error labels. An absent outcome is labeled as a result, not inferred to
be successful. Private reasoning and raw user prompts are not excerpted. These attachment filters do not filter the
regular `/v1/records` telemetry stream. No transcript is read for a report while the report tool is unused.

At submission, `payload.evidence.tool` names the operation being reported, such as `instance_upsert`, rather than
the reporting tool. Its most recent matching execution anchors selection. The provider attaches nearby execution
records, retaining call/response pairs by their actual tool call IDs, in chronological order and within the existing
five-record limit. This can preserve a successful write and its subsequent unchanged read-back. Without a matching
tool, selection falls back to the latest execution neighborhood; this is a deterministic heuristic, not semantic
relevance judgment. If no execution exists, the attachment is empty. Candidate excerpts are discarded after the
request. When a resumed session re-establishes its runtime binding, an on-demand read can include its persisted
history from before the process restart. All excerpts are masked before clipping.

When the anchor has a correlated call/response pair, unpaired neighboring responses do not fill unused attachment
slots. For parallel calls, the excerpts identify the exact invocations of selected results, including when several
calls use the same tool name. The 400-character budget is shared across visible calls; fewer pairs are selected if
their tool names cannot all fit. A long sibling call cannot hide the invocation that produced an attached result.

Correlation IDs stay local. Success/error labels and short calls use the existing `excerpt` field, so the Gateway
API and database need no change for this behavior. The stable client report ID derives from the session and tool
call, so replaying one call does not create another report.

## Transport and results

The tool reuses Gateway address resolution, Creator Hub authentication, local secret masking, and consent checks,
then sends JSON to `POST /v1/agent-reports`. It does not send a Slack webhook request. Deploy the Gateway schema and
endpoint before enabling the tool for users; the Gateway client integration contract describes the wire schema.

The response distinguishes a saved report, duplicate request, and missing consent. `notified: true` means a Slack
alert was queued by the Gateway, not delivered. Failures, cancellation, or unavailable context return a concise tool
result and let the agent continue its task. There is no retry queue or offline delivery in this version.

Use the tool inside the bound OVERDARE agent session, including when driving that session from another client.
The standalone product MCP server does not expose this tool because it cannot provide the executing agent's context.
The bundled skill contains examples for all three report kinds and criteria for avoiding speculative or duplicate
reports. The former Python Slack sender is removed; no client webhook or token-file fallback remains.
