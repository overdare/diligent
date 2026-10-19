// @summary Strict skill report contracts and authenticated Gateway HTTP transmission.

import { z } from "zod";
import { maskValue } from "./masking";
import { resolveEndpoint, resolveToken } from "./shared";

const prose = (max: number) => z.string().trim().min(1).max(max);
export const AgentReportKindSchema = z.enum(["agent_failure", "studio_bug", "feature_request"]);
const modelEvidence = z.object({ tool: prose(128).optional(), details: prose(2000).optional() }).strict();
const modelPayload = z
  .object({
    title: prose(200),
    task_context: prose(1000),
    problem: prose(2000),
    report_reason: prose(1000),
    suggestion: prose(1000),
    cause: prose(1000).nullable().optional(),
    evidence: modelEvidence.optional(),
  })
  .strict();

export const AgentReportToolInputSchema = z
  .object({
    kind: AgentReportKindSchema,
    payload: modelPayload,
  })
  .strict();

export const RecentRecordSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    event_ts: z.string().datetime({ offset: true }),
    role: prose(32),
    tool: prose(128).optional(),
    excerpt: z.string().max(400),
  })
  .strict();
export type RecentRecord = z.infer<typeof RecentRecordSchema>;

const identifier = prose(256).refine((value) => !/[\\/]/.test(value) && !value.includes(".."), {
  message: "Identifiers must not contain path separators",
});
export const AgentReportWireSchema = z
  .object({
    client_report_id: prose(64),
    project_id: identifier,
    session_id: identifier,
    seq: z.number().int().nonnegative().optional(),
    event_ts: z.string().datetime({ offset: true }),
    kind: AgentReportKindSchema,
    payload: modelPayload
      .extend({
        cwd: z.string().max(512).optional(),
        version: prose(64).optional(),
        evidence: modelEvidence
          .extend({
            recent_records: z.array(RecentRecordSchema).max(5).default([]),
          })
          .strict()
          .default({ recent_records: [] }),
      })
      .strict(),
  })
  .strict();
export type AgentReportWire = z.infer<typeof AgentReportWireSchema>;

export const AgentReportReceiptSchema = z
  .object({
    report_id: z.number().int().positive().nullable(),
    reported_at: z.string().datetime({ offset: true }),
    stored: z.boolean(),
    notified: z.boolean(),
    reason: z.enum(["no_consent", "duplicate"]).nullable().optional().default(null),
  })
  .refine(
    (receipt) =>
      receipt.stored
        ? receipt.report_id !== null && receipt.reason === null
        : receipt.report_id === null && !receipt.notified,
    { message: "Contradictory report receipt" },
  );
export type AgentReportReceipt = z.infer<typeof AgentReportReceiptSchema>;

export class AgentReportPostError extends Error {
  constructor(
    readonly httpStatus: number | null,
    message: string,
    readonly reason?: "no_consent",
  ) {
    super(message);
    this.name = "AgentReportPostError";
  }
}

export async function postAgentReport(
  wire: AgentReportWire,
  signal: AbortSignal,
  isAllowed: () => boolean = () => true,
): Promise<AgentReportReceipt> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(5_000)]);
  requestSignal.throwIfAborted();
  const body = AgentReportWireSchema.parse(wire);
  const token = await resolveToken();
  requestSignal.throwIfAborted();
  if (!isAllowed()) throw new AgentReportPostError(null, "Consent unavailable", "no_consent");
  if (!token) throw new AgentReportPostError(null, "Gateway authentication unavailable");
  const response = await fetch(resolveEndpoint() + "/v1/agent-reports", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ ...body, payload: maskValue(body.payload) }),
    signal: requestSignal,
  });
  if (!response.ok) throw new AgentReportPostError(response.status, "Gateway rejected the report");
  return AgentReportReceiptSchema.parse(await response.json());
}
