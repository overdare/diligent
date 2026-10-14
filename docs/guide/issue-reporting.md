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
directory, optional runtime version, and up to five short recent entries. It retains context separately for each
session and rejects conflicting attribution. Reports use the same project attribution as session telemetry. Before
any entry exists, an explicitly configured project is sufficient; without either source, reporting is unavailable.
The tool never scans the filesystem for a session or asks the model to supply identities or authentication.

Recent excerpts omit reasoning and raw user prompts, mask secrets before clipping, and exclude the reporting tool's
own calls/results. The stable client report ID derives from the session and tool call, so replaying one call does not
create another report.

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
