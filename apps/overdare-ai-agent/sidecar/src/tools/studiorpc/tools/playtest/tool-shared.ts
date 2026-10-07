// @summary Shared schemas and execution helpers for Studio playtest tools.
import { z } from "zod";
import type { call } from "../../rpc";
import type { ToolContext } from "../../types";
import type { WriteLock } from "../../write-lock";
import type { DecisionProviderOptions } from "./decision-provider";
import { DEFAULT_INTENT_DECISION_INTERVAL_MS, DEFAULT_STUCK_TIMEOUT_MS } from "./runtime";

export const nameSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/, "Use a short lowercase harness name");
const sourceSchema = z
  .string()
  .min(1)
  .refine(
    (source) => !source.includes("\0") && Buffer.byteLength(source, "utf8") <= 128 * 1024,
    "Luau source must be at most 128 KiB without NUL",
  );

export const harnessParams = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("describe") }).strict(),
  z.object({ operation: z.literal("list") }).strict(),
  z.object({ operation: z.literal("read"), name: nameSchema }).strict(),
  z.object({ operation: z.literal("install"), name: nameSchema, source: sourceSchema }).strict(),
  z
    .object({
      operation: z.literal("update"),
      name: nameSchema,
      source: sourceSchema,
      expectedSourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);

export const runParams = z
  .object({
    harnessName: nameSchema.describe(
      "Installed editable Studio harness name. Use game_playtest_harness to author or maintain it first.",
    ),
    goal: z
      .string()
      .min(1)
      .max(1000)
      .describe("The playtest objective for the decision provider's candidate selection."),
    decisionProvider: z
      .enum(["laya", "openai-decisions"])
      .optional()
      .describe("Decision backend; default laya. OpenAI Decisions requires OPENAI_API_KEY on the sidecar host."),
    observationMode: z
      .enum(["structured", "structured+image"])
      .optional()
      .describe(
        "Default structured. structured+image sends actual owned viewport PNGs with model requests; requires an image-capable provider and accessible captures.",
      ),
    maxVisualAgeMs: z
      .number()
      .int()
      .min(250)
      .max(30000)
      .optional()
      .describe("Maximum captured image age before dispatching a new model choice; default 2000 ms."),
    maxDurationMs: z
      .number()
      .int()
      .min(1000)
      .max(180000)
      .optional()
      .describe("Bounded episode duration, default 80000 ms."),
    stuckTimeoutMs: z
      .number()
      .int()
      .min(0)
      .max(180000)
      .optional()
      .describe(
        `Stop after this much time without meaningful progress; default ${DEFAULT_STUCK_TIMEOUT_MS} ms. 0 disables. Adapter progress.waiting can declare one bounded normal wait per progress sequence.`,
      ),
    decisionUrl: z
      .string()
      .url()
      .optional()
      .describe(
        "Laya endpoint override; otherwise DILIGENT_LAYA_URL or localhost:11435. OpenAI Decisions uses only its official HTTPS endpoint.",
      ),
    intentDecisionIntervalMs: z
      .number()
      .int()
      .min(250)
      .max(30000)
      .optional()
      .describe(
        `For intent-tagged candidates, reconsider the current goal at input boundaries after this interval; default ${DEFAULT_INTENT_DECISION_INTERVAL_MS} ms. Completion, disappearance or changed validity can trigger an earlier decision.`,
      ),
    model: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe(
        "Provider model. Laya uses DILIGENT_LAYA_MODEL or laya:en; OpenAI Decisions currently uses gpt-6-luna.",
      ),
  })
  .strict();

export interface PlaytestToolOptions {
  callRpc: typeof call;
  cwd: string;
  writeLock?: WriteLock;
  beforeMutation?: () => string | undefined;
  decisionOptions?: DecisionProviderOptions;
}

export function withSignal(rpc: typeof call, ctx: ToolContext): typeof call {
  return (method, params, options) => rpc(method, params, { ...options, signal: ctx.signal });
}

export async function approve(
  ctx: ToolContext,
  toolName: string,
  description: string,
  details: Record<string, unknown>,
): Promise<boolean> {
  return (await ctx.approve({ permission: "execute", toolName, description, details })) !== "reject";
}

function validationText(reply: unknown): string {
  if (typeof reply === "string") return reply;
  if (reply && typeof reply === "object" && "output" in reply && typeof reply.output === "string") return reply.output;
  return JSON.stringify(reply);
}

export async function validate(rpc: typeof call, guids: string[]): Promise<{ output: string; valid: boolean }> {
  const output = validationText(
    await rpc("lua.validate", { mode: "strict", targetGuids: guids }, { timeoutMs: 120000 }),
  );
  const match = /SUMMARY\s+scripts=\d+\s+errors=(\d+)/.exec(output);
  return { output, valid: Boolean(match && Number(match[1]) === 0) };
}
