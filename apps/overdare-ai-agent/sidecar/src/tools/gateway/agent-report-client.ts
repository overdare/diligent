// @summary Wire contract, Markdown composer and POST client for gateway agent failure reports.

import type { FailureKind, FailureSignal } from "./agent-report-selectors";
import { maskValue } from "./masking";
import { resolveEndpoint, resolveToken } from "./shared";

export const AGENT_REPORT_TOOL_NAME = "agent_report_failure";

export const AGENT_REPORT_CAUSES = [
  "model_error",
  "missing_tool",
  "missing_context",
  "ambiguous_prompt",
  "tool_bug",
  "user_error",
] as const;
export type AgentReportCause = (typeof AGENT_REPORT_CAUSES)[number];

/** POST /v1/agent-reports body — see diligent-gateway contract/CLIENT_INTEGRATION.md §12. */
export interface AgentReportWire {
  client_report_id: string;
  session_id: string;
  project_id: string;
  seq?: number;
  event_ts: string;
  kind: FailureKind;
  tool?: string;
  cause: AgentReportCause;
  title: string;
  summary_md: string;
  evidence: Record<string, number | string>;
  release?: string;
}

export function composeReportMarkdown(input: {
  title: string;
  signal: FailureSignal;
  cause: AgentReportCause;
  sessionId: string;
  seq?: number;
  release?: string;
  summary: string;
}): string {
  const { signal } = input;
  return [
    `## ${input.title}`,
    `kind: ${signal.kind} · tool: ${signal.tool ?? "-"} · count: ${signal.count} · cause: ${input.cause}`,
    `session: ${input.sessionId} · seq: ${input.seq ?? "-"} · release: ${input.release ?? "-"}`,
    "",
    input.summary,
  ].join("\n");
}

/**
 * The context injection that asks the agent to judge the armed stretch on its next round.
 * `signalId` scopes the armed signal to this one injection: the tool only accepts it back verbatim,
 * so a concurrent thread's agent cannot file a report against a signal it never saw.
 */
export function buildAssessmentMessage(signal: FailureSignal, signalId: string): string {
  const lead =
    signal.kind === "aborted"
      ? "Your previous turn did not complete (the user stopped it or it was interrupted)."
      : `A failure signal fired: kind=${signal.kind}, tool=${signal.tool ?? "-"}, count=${signal.count}.`;
  return [
    "<system-reminder>",
    lead,
    "Before continuing, assess whether the preceding work was a genuine agent failure — you were going in circles, misusing a tool, or the user discarded your work because it was wrong.",
    `If and only if it was, call ${AGENT_REPORT_TOOL_NAME} exactly once with signal_id="${signalId}", an honest cause, a one-line title, and a summary of what you attempted, why it failed, and what would have helped. Describe your own behaviour; do not quote the user's messages.`,
    "If it was not a failure (the user changed their mind, the retries were reasonable), do not call the tool. Either way, then continue the task.",
    "</system-reminder>",
  ].join("\n");
}

export async function postAgentReport(wire: AgentReportWire): Promise<void> {
  const token = await resolveToken();
  if (!token) throw new Error("Agent report failed: gateway token is unavailable");
  const body: AgentReportWire = { ...wire, title: maskValue(wire.title), summary_md: maskValue(wire.summary_md) };
  const response = await fetch(`${resolveEndpoint()}/v1/agent-reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Agent report failed: gateway returned ${response.status}`);
}
