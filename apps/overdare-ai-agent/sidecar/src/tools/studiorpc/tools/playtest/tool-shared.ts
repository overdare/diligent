// @summary Shared schemas and execution helpers for Studio playtest tools.
import { z } from "zod";
import type { call } from "../../rpc";
import type { ToolContext } from "../../types";
import type { WriteLock } from "../../write-lock";
import type { DecisionProviderOptions } from "./decision-provider";
import { DEFAULT_INTENT_DECISION_INTERVAL_MS, DEFAULT_STUCK_TIMEOUT_MS } from "./runtime";

export const DEFAULT_RUN_DURATION_MS = 80_000;
export const MAX_SINGLE_PLAYER_DURATION_MS = 180_000;
export const MAX_TWO_PLAYER_DURATION_MS = 900_000;

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

const PROVIDER_ONLY_ARGS = ["decisionProvider", "model", "decisionUrl", "maxVisualAgeMs"] as const;

export const runParams = z
  .object({
    harnessName: nameSchema.describe(
      "Installed editable Studio harness name. Use game_playtest_harness to author or maintain it first.",
    ),
    mode: z
      .enum(["autonomous", "verification"])
      .optional()
      .describe(
        "autonomous (default): multi-candidate frames call the decision provider and decisionEvidence measures model participation. verification: scripted acceptance with no decision provider; the first offered candidate runs in adapter order, decisionEvidence is not_applicable, and requirement checks decide the verdict. Use verification for feature/regression acceptance and autonomous for play or exploration.",
      ),
    numberOfPlayer: z
      .union([z.literal(1), z.literal(2)])
      .optional()
      .describe(
        "Owned real PIE player count: default 1, or 2 with authoritative state.multiplayerActors and stable injectable client binding.",
      ),
    actorGoals: z
      .record(z.string().min(1).max(128), z.string().min(1).max(1000))
      .optional()
      .describe("Optional actorId-to-goal map; missing actors use goal. Two-player mode only."),
    goal: z
      .string()
      .min(1)
      .max(1000)
      .describe("The playtest objective; the decision provider selects candidates against it in autonomous mode."),
    decisionProvider: z
      .enum(["laya", "openai-decisions"])
      .optional()
      .describe(
        "Decision backend; omit to use the sidecar host's configured default named in the tool description. OpenAI Decisions requires OPENAI_API_KEY on the sidecar host. Autonomous mode only.",
      ),
    observationMode: z
      .enum(["structured", "structured+image"])
      .optional()
      .describe(
        "Default structured. structured+image sends actual owned viewport PNGs with model requests; requires an image-capable provider and accessible captures. Autonomous single-player only.",
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
      .max(MAX_TWO_PLAYER_DURATION_MS)
      .optional()
      .describe(
        `Bounded episode duration, default ${DEFAULT_RUN_DURATION_MS} ms; maximum ${MAX_SINGLE_PLAYER_DURATION_MS} for one player or ${MAX_TWO_PLAYER_DURATION_MS} for two.`,
      ),
    maxPhysicalBatchDurationMs: z
      .number()
      .int()
      .min(250)
      .max(5000)
      .optional()
      .describe(
        "Two-player native balanced input batch limit; default 2000 ms, maximum 5000 ms. Longer movement holds reduce stop/start overhead without changing game movement rules.",
      ),
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
  .strict()
  .superRefine((args, ctx) => {
    const twoPlayer = args.numberOfPlayer === 2;
    if (args.maxPhysicalBatchDurationMs !== undefined && !twoPlayer)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxPhysicalBatchDurationMs"],
        message: "maxPhysicalBatchDurationMs requires two-player mode",
      });
    if (!twoPlayer && (args.maxDurationMs ?? DEFAULT_RUN_DURATION_MS) > MAX_SINGLE_PLAYER_DURATION_MS)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxDurationMs"],
        message: `Single-player maxDurationMs cannot exceed ${MAX_SINGLE_PLAYER_DURATION_MS}`,
      });
    if (args.actorGoals && (!twoPlayer || Object.keys(args.actorGoals).length > 2))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actorGoals"],
        message: "actorGoals requires two-player mode and at most two actor goals",
      });
    if (twoPlayer && args.observationMode === "structured+image")
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["observationMode"],
        message: "Two-player mode requires structured actor projections; screenshots are main-targeted",
      });
    if (args.mode !== "verification") return;
    for (const key of PROVIDER_ONLY_ARGS) {
      if (args[key] !== undefined)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} configures model decisions; verification mode never calls a decision provider`,
        });
    }
    if (args.observationMode === "structured+image")
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["observationMode"],
        message: "verification mode has no model decisions to show images to; use structured observation",
      });
  });

export interface PlaytestToolOptions {
  callRpc: typeof call;
  cwd: string;
  writeLock?: WriteLock;
  /** Captures the request's rollback baseline; returns a warning when capture was skipped. */
  beforeMutation?: (ctx: ToolContext) => Promise<string | undefined>;
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
