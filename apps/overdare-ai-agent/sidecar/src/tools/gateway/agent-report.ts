// @summary Skill-callable issue reporter using bound session context and existing Gateway helpers.

import { createHash } from "node:crypto";
import type { Tool } from "@diligent/core/tool-contract";
import type { HookInput } from "@diligent/runtime";
import {
  AgentReportPostError,
  AgentReportToolInputSchema,
  postAgentReport,
  type RecentRecord,
  RecentRecordSchema,
} from "./agent-report-client";
import { maskValue } from "./masking";

export interface SessionReportContext {
  projectId: string;
  userId: string;
  seq?: number;
  recentRecords: RecentRecord[];
}

interface AgentReportToolOptions {
  cwd: string;
  projectId?: string;
  canTransmitRecords?: () => boolean;
  getSessionContext: (sessionId: string) => SessionReportContext | null | undefined;
}

function clip(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("");
}

export function previewSessionEntry(input: HookInput): RecentRecord | undefined {
  const entry = maskValue(input.entry) as Record<string, unknown> | undefined;
  if (!entry || typeof input.seq !== "number") return undefined;
  const message = entry.message as Record<string, unknown> | undefined;
  let role: string;
  let tool: string | undefined;
  let excerpt: string;
  if (entry.type === "error") {
    role = "error";
    excerpt = typeof entry.error === "string" ? entry.error : JSON.stringify(entry.error ?? "");
  } else if (entry.type === "message" && message) {
    role = String(message.role ?? "");
    if (role === "tool_result") {
      tool = typeof message.toolName === "string" ? message.toolName : undefined;
      if (tool === "agent_report") return undefined;
      excerpt = typeof message.output === "string" ? message.output : "";
    } else if (role === "user") {
      excerpt = "[user request]";
    } else if (role === "assistant") {
      const content = message.content;
      if (typeof content === "string") excerpt = content;
      else if (Array.isArray(content)) {
        if (content.some((block) => block?.type === "tool_call" && block?.name === "agent_report")) return undefined;
        excerpt = content
          .filter((block) => block?.type === "text")
          .map((block) => block.text ?? "")
          .join("\n");
      } else excerpt = "";
    } else return undefined;
  } else return undefined;
  const parsed = RecentRecordSchema.safeParse({
    seq: input.seq,
    event_ts: entry.timestamp,
    role,
    ...(tool ? { tool } : {}),
    excerpt: clip(excerpt, 400),
  });
  return parsed.success ? parsed.data : undefined;
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
      const clientReportId = createHash("sha256")
        .update(JSON.stringify([ctx.sessionId, ctx.toolCallId]))
        .digest("hex");
      const version = (process.env.OVERDARE_AI_AGENT_VERSION ?? process.env.DILIGENT_SERVER_VERSION)?.trim();
      try {
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
              evidence: { ...args.payload.evidence, recent_records: snapshot?.recentRecords ?? [] },
            },
          },
          ctx.signal,
          options.canTransmitRecords,
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
