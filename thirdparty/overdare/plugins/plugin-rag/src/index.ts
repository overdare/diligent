import type { z } from "zod";
import * as overdaresearch from "./overdaresearch.ts";
import * as overdaresearchDeep from "./overdaresearch_deep.ts";

type ToolRenderPayload = {
  version: 1;
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
  name: "@overdare/plugin-rag",
  apiVersion: "1.0",
  version: "0.1.0",
};

// ── Tool factory ──────────────────────────────────────────────────────────────

export async function createTools(_ctx: { cwd: string }): Promise<Tool[]> {
  return [
    {
      name: overdaresearch.name,
      description: overdaresearch.description,
      parameters: overdaresearch.parameters,
      supportParallel: true,
      async execute(args, ctx) {
        return overdaresearch.execute(args as z.infer<typeof overdaresearch.parameters>, ctx);
      },
    },
    {
      name: overdaresearchDeep.name,
      description: overdaresearchDeep.description,
      parameters: overdaresearchDeep.parameters,
      supportParallel: true,
      async execute(args, ctx) {
        return overdaresearchDeep.execute(args as z.infer<typeof overdaresearchDeep.parameters>, ctx);
      },
    },
  ];
}
