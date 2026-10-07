// @summary Diligent tools for persistent UGC harnesses and swappable text/vision decision providers.
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { call } from "../../rpc";
import type { Tool, ToolContext } from "../../types";
import type { WriteLock } from "../../write-lock";
import { createCoverageTracker } from "./coverage";
import { createDecisionProvider, type DecisionProviderOptions } from "./decision-provider";
import { HARNESS_CONTRACT, installCode, listHarnesses, readHarness, sourceHash, updateCode } from "./harness";
import { DEFAULT_INTENT_DECISION_INTERVAL_MS, DEFAULT_STUCK_TIMEOUT_MS, runPlaytest } from "./runtime";
import { createVisualObserver } from "./visual-observation";

const nameSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/, "Use a short lowercase harness name");
const sourceSchema = z
  .string()
  .min(1)
  .refine(
    (source) => !source.includes("\0") && Buffer.byteLength(source, "utf8") <= 128 * 1024,
    "Luau source must be at most 128 KiB without NUL",
  );
const harnessParams = z.discriminatedUnion("operation", [
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
const runParams = z
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

interface PlaytestToolOptions {
  callRpc: typeof call;
  cwd: string;
  writeLock?: WriteLock;
  beforeMutation?: () => string | undefined;
  decisionOptions?: DecisionProviderOptions;
}
function withSignal(rpc: typeof call, ctx: ToolContext): typeof call {
  return (method, params, options) => rpc(method, params, { ...options, signal: ctx.signal });
}
async function approve(
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
async function validate(rpc: typeof call, guids: string[]): Promise<{ output: string; valid: boolean }> {
  const output = validationText(
    await rpc("lua.validate", { mode: "strict", targetGuids: guids }, { timeoutMs: 120000 }),
  );
  const match = /SUMMARY\s+scripts=\d+\s+errors=(\d+)/.exec(output);
  return { output, valid: Boolean(match && Number(match[1]) === 0) };
}

export function createPlaytestTools(options: PlaytestToolOptions): Tool[] {
  const harness: Tool = {
    name: "studiorpc_game_playtest_harness",
    description:
      "Author and maintain the current UGC game's playtest controller as editable Luau code inside Studio. describe returns the contract; list discovers installed names; read returns current source/hash or found:false with the author/install next step. A missing harness is normal for a new project. install persists an adapter and common driver; update checks expectedSourceHash and refreshes the driver. Derive bindings, state/event transitions, parameterized actions, actual effect checks and meaningful model decision points from this game's scripts/GUI and the user's objective. Expose direct controls and optional bounded assists according to the test; keep user-adjustable assistance separate from test goals and game rules. For player exploration, preserve unknowns and route/recovery choices instead of supplying a hidden solution. Optional intent-tagged steps support model-selected goals spanning multiple inputs; the adapter computes each goal independently and receives no semantic choice callback. Validate, run game_playtest, inspect decisionEvidence/effects/coverage and improve between runs. Edits save the project and are refused during PIE. Game-specific logic stays in Studio.",
    parameters: harnessParams,
    async execute(args, ctx) {
      const parsed = harnessParams.parse(args);
      if (parsed.operation === "describe") return { output: HARNESS_CONTRACT, metadata: { protocolVersion: 1 } };
      const rpc = withSignal(options.callRpc, ctx);
      if (parsed.operation === "list") {
        const harnesses = await listHarnesses(rpc);
        return { output: JSON.stringify({ harnesses }, null, 2), metadata: { harnesses } };
      }
      if (parsed.operation === "read") {
        const inventory = await listHarnesses(rpc);
        const asset = await readHarness(rpc, parsed.name, inventory);
        if (!asset) {
          const missing = {
            found: false,
            name: parsed.name,
            availableHarnesses: inventory.map((a) => a.name),
            nextAction: "inspect_game_and_install",
            instruction:
              "Inspect this game's scripts and test objective, use describe for the contract, then author and install a harness. Do not copy unrelated game bindings.",
          };
          return { output: JSON.stringify(missing, null, 2), metadata: missing };
        }
        return { output: JSON.stringify({ found: true, ...asset }, null, 2), metadata: { found: true, ...asset } };
      }
      const status = (await rpc("game.pie.status", {})) as { running?: boolean };
      if (status.running) throw new Error("Stop PIE before installing or updating harness code");
      const asset = await readHarness(rpc, parsed.name);
      if (parsed.operation === "install" && asset)
        throw new Error("Harness already exists; read it and update using its source hash");
      if (parsed.operation === "update" && (!asset || asset.sourceHash !== parsed.expectedSourceHash)) {
        throw new Error(
          "Harness source hash changed or the harness is missing; read the current source before updating",
        );
      }
      if (
        !(await approve(ctx, harness.name, `${parsed.operation} and save Studio harness ${parsed.name}`, {
          operation: parsed.operation,
          name: parsed.name,
        }))
      ) {
        return { output: "[Rejected by user]", metadata: { error: true } };
      }
      const release = await options.writeLock?.acquire();
      try {
        const warning = options.beforeMutation?.();
        const code =
          parsed.operation === "install"
            ? installCode(parsed.name, parsed.source)
            : updateCode(parsed.name, asset!.source, parsed.source);
        await rpc("execute.luau", { target: "Editor", code }, { timeoutMs: 15000 });
        // Do not replay a successful editor transaction if saving or validation fails.
        try {
          await rpc("level.save.file", {}, { timeoutMs: 15000 });
        } catch (error) {
          throw new Error(
            `Harness edit succeeded but saving failed. Inspect/save the existing edit; do not replay it. ${String(error)}`,
          );
        }
        const installed = await readHarness(rpc, parsed.name);
        if (!installed || installed.sourceHash !== sourceHash(parsed.source) || !installed.driverGuid) {
          throw new Error("Harness edit succeeded but source/driver readback did not match; inspect the Studio assets");
        }
        const checked = await validate(rpc, [installed.moduleGuid, installed.driverGuid]);
        return {
          output: `${warning ? `${warning}\n` : ""}${JSON.stringify({ ...installed, source: undefined, valid: checked.valid }, null, 2)}\n\n${checked.output}`,
          metadata: {
            name: installed.name,
            sourceHash: installed.sourceHash,
            moduleGuid: installed.moduleGuid,
            driverGuid: installed.driverGuid,
            frameName: installed.frameName,
            valid: checked.valid,
          },
        };
      } finally {
        release?.();
      }
    },
  };
  const run: Tool = {
    name: "studiorpc_game_playtest",
    description:
      "Start a fresh Studio play session, run an editable UGC harness with the selected decision provider, observe effects, then stop the same session. Default Laya uses structured state; OpenAI Decisions supports structured state plus actual viewport images. OpenAI requests use server-side OPENAI_API_KEY and may transmit game observations/images to the official API. Visual mode requires one targeted client and screenshot files readable by the sidecar, with optional STUDIO_SCREENSHOT_REMOTE_ROOT/LOCAL_ROOT mapping. Continuous observation, stale-choice checks, bounded input, retained intents and the 15-second progress watchdog remain active. Captures happen at model-decision boundaries, not every input step; singleton and retained steps are automatic. Records provider settings, visual metadata/artifacts and actual results. Requires stopped PIE and a validated harness. Success comes only from the adapter's observed game terminal, not a model estimate.",
    parameters: runParams,
    async execute(args, ctx) {
      const parsed = runParams.parse(args);
      const chooser = await createDecisionProvider(
        {
          provider: parsed.decisionProvider ?? "laya",
          observationMode: parsed.observationMode ?? "structured",
          goal: parsed.goal,
          model: parsed.model,
          url: parsed.decisionUrl,
        },
        options.decisionOptions,
      );
      const rpc = withSignal(options.callRpc, ctx);
      const asset = await readHarness(rpc, parsed.harnessName);
      if (!asset?.driverGuid) throw new Error("Install the Studio harness and its observation driver before running");
      const checked = await validate(rpc, [asset.moduleGuid, asset.driverGuid]);
      if (!checked.valid)
        throw new Error(`Harness validation did not pass; repair it before playing.\n${checked.output}`);
      if (
        !(await approve(ctx, run.name, `Start, play and stop Studio using ${parsed.harnessName}`, {
          harnessName: parsed.harnessName,
          maxDurationMs: parsed.maxDurationMs ?? 80000,
          stuckTimeoutMs: parsed.stuckTimeoutMs ?? DEFAULT_STUCK_TIMEOUT_MS,
          decisionProvider: chooser.metadata.provider,
          observationMode: chooser.metadata.observationMode,
          endpoint: chooser.metadata.endpoint,
        }))
      ) {
        return { output: "[Rejected by user]", metadata: { error: true } };
      }
      ctx.onUpdate?.(`Preparing ${chooser.metadata.provider} for ${parsed.harnessName}...`);
      await chooser.prepare(ctx.signal);
      const directory = join(options.cwd, ".overdare", "playtests", `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`);
      await mkdir(directory, { recursive: true });
      const tracePath = join(directory, "trace.jsonl");
      const decisionConfig = { ...chooser.metadata, maxVisualAgeMs: parsed.maxVisualAgeMs ?? 2000 };
      const runConfig = {
        goal: parsed.goal,
        maxDurationMs: parsed.maxDurationMs ?? 80000,
        stuckTimeoutMs: parsed.stuckTimeoutMs ?? DEFAULT_STUCK_TIMEOUT_MS,
        intentDecisionIntervalMs: parsed.intentDecisionIntervalMs ?? DEFAULT_INTENT_DECISION_INTERVAL_MS,
      };
      await appendFile(
        tracePath,
        `${JSON.stringify({ at: new Date().toISOString(), type: "decision_configuration", decisionConfig, runConfig })}\n`,
        "utf8",
      );
      let pending = Promise.resolve();
      let writeFailure: unknown;
      const coverage = createCoverageTracker();
      let lastObservationProgressMs = Number.NEGATIVE_INFINITY;
      const result = await runPlaytest({
        callRpc: options.callRpc,
        harnessId: parsed.harnessName,
        frameName: asset.frameName,
        maxDurationMs: parsed.maxDurationMs ?? 80000,
        stuckTimeoutMs: parsed.stuckTimeoutMs,
        intentDecisionIntervalMs: parsed.intentDecisionIntervalMs,
        signal: ctx.signal,
        choose: chooser.choose,
        maxVisualAgeMs: parsed.maxVisualAgeMs,
        ...(chooser.metadata.observationMode === "structured+image"
          ? {
              captureVisual: createVisualObserver({
                callRpc: options.callRpc,
                directory,
                localRoot: process.env.STUDIO_SCREENSHOT_LOCAL_ROOT,
                remoteRoot: process.env.STUDIO_SCREENSHOT_REMOTE_ROOT,
              }),
            }
          : {}),
        onFrame: coverage.observe,
        onEvent(event) {
          coverage.event(event);
          const line = JSON.stringify({ at: new Date().toISOString(), ...event });
          // Serialize writes; I/O is outside the control path and failures surface at completion.
          pending = pending
            .then(() => appendFile(tracePath, `${line}\n`, "utf8"))
            .catch((error) => {
              writeFailure = error;
            });
          // Keep the full trace on disk while bounding high-frequency UI progress.
          if (event.type !== "observation" || event.atMs - lastObservationProgressMs >= 1000) {
            ctx.onUpdate?.(line);
            if (event.type === "observation") lastObservationProgressMs = event.atMs;
          }
        },
      });
      await pending;
      if (writeFailure)
        throw new Error(`Playtest ended with ${result.outcome}, but trace persistence failed: ${String(writeFailure)}`);
      const summaryPath = join(directory, "summary.json");
      const coveragePath = join(directory, "coverage.json");
      const coverageResult = coverage.summary();
      await writeFile(coveragePath, JSON.stringify(coverageResult, null, 2), "utf8");
      await writeFile(
        summaryPath,
        JSON.stringify(
          {
            harnessName: asset.name,
            sourceHash: asset.sourceHash,
            decisionConfig,
            runConfig,
            ...result,
            coverage: coverageResult,
            coveragePath,
            tracePath,
          },
          null,
          2,
        ),
        "utf8",
      );
      return {
        output: JSON.stringify(
          {
            ...result,
            harnessName: asset.name,
            sourceHash: asset.sourceHash,
            decisionConfig,
            runConfig,
            coverage: coverageResult,
            coveragePath,
            tracePath,
            summaryPath,
          },
          null,
          2,
        ),
        metadata: {
          ...result,
          decisionConfig,
          runConfig,
          coverage: coverageResult,
          coveragePath,
          tracePath,
          summaryPath,
        },
      };
    },
  };
  return [harness, run];
}
