// @summary Skill-callable issue reporter using bound session context and existing Gateway helpers.

import { createHash } from "node:crypto";
import type { Tool } from "@diligent/core/tool-contract";
import { AgentReportPostError, AgentReportToolInputSchema, postAgentReport } from "./agent-report-client";
import { maskValue } from "./masking";
import { readReportEvidence } from "./report-evidence";

export interface SessionReportContext {
  projectId: string;
  userId: string;
  seq?: number;
  transcriptPath: string;
}

interface AgentReportToolOptions {
  cwd: string;
  projectId?: string;
  canTransmitRecords?: () => boolean;
  getSessionContext: (sessionId: string) => SessionReportContext | null | undefined;
}

class AgentReportContextError extends Error {}

function clip(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("");
}

export function createAgentReportTool(options: AgentReportToolOptions): Tool<typeof AgentReportToolInputSchema> {
  return {
    name: "agent_report",
    description:
      "Submit a checked agent failure, suspected Studio bug, or concrete feature request. " +
      "Use the session-issue-report skill to judge and write the report; execution metadata and authentication are supplied automatically.",
    parameters: AgentReportToolInputSchema,
    execute: async (args, ctx) => {
      if (!options.canTransmitRecords?.()) return { output: "Report skipped: consent not granted. Continue the task." };
      if (!ctx.sessionId) return { output: "Report unavailable: no executing session. Continue the task." };
      const context = options.getSessionContext(ctx.sessionId);
      if (context === null) return { output: "Report unavailable: conflicting session context. Continue the task." };
      const projectId = context?.projectId ?? options.projectId?.trim();
      if (!projectId)
        return { output: "Report unavailable: exact session/project context missing. Continue the task." };
      const snapshot = context ? structuredClone(context) : undefined;
      const assertBinding = () => {
        const current = options.getSessionContext(ctx.sessionId!);
        if (
          current === null ||
          (current && current.projectId !== projectId) ||
          (snapshot &&
            (!current || current.userId !== snapshot.userId || current.transcriptPath !== snapshot.transcriptPath))
        ) {
          throw new AgentReportContextError("Session binding changed");
        }
      };
      const clientReportId = createHash("sha256")
        .update(JSON.stringify([ctx.sessionId, ctx.toolCallId]))
        .digest("hex");
      const version = (process.env.OVERDARE_AI_AGENT_VERSION ?? process.env.DILIGENT_SERVER_VERSION)?.trim();
      try {
        const recentRecords = snapshot
          ? await readReportEvidence({
              sessionId: ctx.sessionId,
              transcriptPath: snapshot.transcriptPath,
              throughSeq: snapshot.seq ?? 0,
              reportedTool: args.payload.evidence?.tool,
              signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(2_000)]),
            })
          : [];
        assertBinding();
        const receipt = await postAgentReport(
          {
            client_report_id: clientReportId,
            project_id: projectId,
            session_id: ctx.sessionId,
            ...(snapshot?.seq !== undefined ? { seq: snapshot.seq } : {}),
            event_ts: new Date().toISOString(),
            kind: args.kind,
            payload: {
              ...args.payload,
              cwd: clip(maskValue(options.cwd), 512),
              ...(version ? { version: clip(version, 64) } : {}),
              evidence: {
                ...args.payload.evidence,
                recent_records: recentRecords,
              },
            },
          },
          ctx.signal,
          () => {
            const allowed = options.canTransmitRecords?.() ?? false;
            assertBinding();
            return allowed;
          },
        );
        if (!receipt.stored) {
          const reason =
            receipt.reason === "duplicate"
              ? "duplicate request"
              : receipt.reason === "no_consent"
                ? "consent not granted"
                : "not stored";
          return { output: "Report skipped: " + reason + ". Continue the task." };
        }
        return {
          output:
            "Report saved (#" +
            receipt.report_id +
            "). " +
            (receipt.notified ? "Slack alert queued. " : "") +
            "Continue the task.",
        };
      } catch (error) {
        if (ctx.signal.aborted) return { output: "Report canceled. Continue the task." };
        if (error instanceof AgentReportContextError) {
          return { output: "Report unavailable: conflicting session context. Continue the task." };
        }
        if (error instanceof AgentReportPostError && error.reason === "no_consent") {
          return { output: "Report skipped: consent not granted. Continue the task." };
        }
        const status =
          error instanceof AgentReportPostError && error.httpStatus !== null ? " (HTTP " + error.httpStatus + ")" : "";
        return { output: "Report failed" + status + ". Continue the task." };
      }
    },
  };
}
