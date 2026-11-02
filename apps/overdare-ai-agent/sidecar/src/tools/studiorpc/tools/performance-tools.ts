// @summary Exposes two small shared product tools for performance capture and results.

import { z } from "zod";
import { type call, StudioRpcError } from "../rpc";
import type { Tool, ToolResult } from "../types";
import { getPerformanceService } from "./performance-service";

const target = z.union([
  z.object({ pieSessionId: z.string().min(1).max(256), clientId: z.string().min(1).max(256) }).strict(),
  z
    .object({
      pid: z.number().int().positive(),
      startTimeUtc: z.string().datetime({ offset: true }),
      role: z.literal("dedicated_server"),
    })
    .strict(),
]);
export const captureParameters = z
  .union([
    z
      .object({
        action: z.literal("start").default("start"),
        case: z.string().trim().min(1).max(80),
        seconds: z.number().min(1).max(60).default(30),
        target: target.optional(),
        serverPids: z.array(z.number().int().positive()).max(4).optional(),
      })
      .strict(),
    z
      .object({
        action: z.literal("stop"),
        jobId: z.string().min(1).max(80),
        outcome: z.enum(["completed", "failed", "cancelled"]),
        reason: z.string().trim().min(1).max(240).optional(),
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (value.action === "stop" && value.outcome !== "completed" && !value.reason)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reason"],
        message: "A failed or cancelled scenario requires a reason",
      });
    if (value.action === "start" && value.target && "pid" in value.target && value.serverPids?.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["serverPids"],
        message: "OS-only targets cannot have additional server PIDs",
      });
  });
const reportParameters = z
  .object({ jobId: z.string().min(1).max(80), baseline: z.string().min(1).max(80).optional() })
  .strict();

function result(value: Record<string, unknown>): ToolResult {
  const output = JSON.stringify(value);
  if (Buffer.byteLength(output) > 16 * 1024)
    throw new Error("RESOURCE_LIMIT: Performance report exceeds 16 KiB; inspect its saved artifacts");
  return { output, metadata: { result: value } };
}

async function execute(operation: () => Promise<Record<string, unknown>>): Promise<ToolResult> {
  try {
    return result(await operation());
  } catch (error) {
    const value = {
      error: true,
      code: error instanceof StudioRpcError ? error.code : -32070,
      message: error instanceof Error ? error.message : String(error),
      data: error instanceof StudioRpcError ? error.data : undefined,
    };
    return { output: JSON.stringify(value), metadata: value };
  }
}

export function createPerformanceTools(cwd: string, rpc: typeof call): Tool[] {
  const service = getPerformanceService(cwd, rpc);
  return [
    {
      name: "studiorpc_performance_capture",
      description:
        "Start a short named performance capture, or stop it with the scenario outcome. For selected Lua function timing, edit gameplay scripts before PIE with paired debug.profilebegin('server.AI.Step') / debug.profileend() around synchronous work (no yield; close before return). Load performance-optimization for examples, compatibility guards and capture workflow. Returns a job ID; use studiorpc_performance_report for progress and integrated distributions, including named luaScopes.",
      parameters: captureParameters,
      execute: async (raw) =>
        execute(async () => {
          const args = captureParameters.parse(raw);
          return args.action === "stop" ? service.stop(args) : service.start(args);
        }),
    },
    {
      name: "studiorpc_performance_report",
      description:
        "Read capture progress or integrated frame, Lua, Slate, named Lua region, and process distributions (count, mean, p50, p95, max). Optionally compare with a baseline job. Poll at least 2 seconds apart. Does not decide performance budgets or pass/fail.",
      parameters: reportParameters,
      execute: async (raw) =>
        execute(async () => {
          const args = reportParameters.parse(raw);
          return service.report(args.jobId, args.baseline);
        }),
    },
  ];
}
