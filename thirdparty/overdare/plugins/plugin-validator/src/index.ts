import type { z } from "zod";
import * as validatelua from "./validatelua.ts";

type ToolRenderPayload = {
  version: 2;
  inputSummary?: string;
  outputSummary?: string;
  blocks: Array<Record<string, unknown>>;
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface ToolContext {
  toolCallId: string;
  signal: AbortSignal;
  approve: (req: ApprovalRequest) => Promise<ApprovalResponse>;
  onUpdate?: (partialResult: string) => void;
}

interface ApprovalRequest {
  permission: "read" | "write" | "execute";
  toolName: string;
  description: string;
  details?: Record<string, unknown>;
}

type ApprovalResponse = "once" | "always" | "reject";

interface ToolResult {
  output: string;
  render?: ToolRenderPayload;
  metadata?: Record<string, unknown>;
}

interface Tool {
  name: string;
  description: string;
  parameters: z.ZodType;
  execute: (args: z.infer<z.ZodType>, ctx: ToolContext) => Promise<ToolResult>;
  supportParallel?: boolean;
}

// ── Plugin manifest ───────────────────────────────────────────────────────────

export const manifest = {
  name: "@overdare/plugin-validator",
  apiVersion: "1.0",
  version: "0.1.0",
};

// ── Tool factory ──────────────────────────────────────────────────────────────

export async function createTools(_ctx: { cwd: string }): Promise<Tool[]> {
  return [
    {
      name: validatelua.name,
      description: validatelua.description,
      parameters: validatelua.parameters,
      supportParallel: false,
      async execute(args, ctx) {
        return validatelua.execute(args as z.infer<typeof validatelua.parameters>, ctx);
      },
    },
  ];
}
