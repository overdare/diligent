// @summary Defines the Studio playtest episode runner and persisted evidence output.
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Tool } from "../../types";
import { createCoverageTracker } from "./coverage";
import { createDecisionProvider, type DecisionProvider, defaultDecisionProvider } from "./decision-provider";
import { readHarness } from "./harness";
import { findRepeatedFailure } from "./run-history";
import { DEFAULT_INTENT_DECISION_INTERVAL_MS, DEFAULT_STUCK_TIMEOUT_MS, runPlaytest } from "./runtime";
import {
  approve,
  DEFAULT_RUN_DURATION_MS,
  type PlaytestToolOptions,
  runParams,
  validate,
  withSignal,
} from "./tool-shared";
import { createVisualObserver } from "./visual-observation";

const toolName = "studiorpc_game_playtest";
const DEFAULT_PHYSICAL_BATCH_MS = 2_000;

function configuredProviderNote(): string {
  try {
    return `Omit decisionProvider, model and decisionUrl to use this host's configured default provider (currently ${defaultDecisionProvider()}) with its default model/endpoint; set them only when the user asks for a specific provider.`;
  } catch (error) {
    return `${error instanceof Error ? error.message : String(error)}; pass decisionProvider explicitly until the host setting is fixed.`;
  }
}

function describeRunTool(): string {
  return `Start a fresh Studio play session, run an editable UGC harness, observe effects, then stop the same session. mode=autonomous (default) lets the selected decision provider choose among meaningful candidates; mode=verification runs scripted acceptance without any provider (first offered candidate, decisionEvidence not_applicable) and is the right mode for feature or regression checks. ${configuredProviderNote()} numberOfPlayer defaults to 1; 2 owns two real injectable PIE clients, binds them to authoritative state.multiplayerActors, and runs independent concurrent actor-local decision and native input RPC loops with separate histories, goals and evidence. Two-player mode is structured-only, retains physical intent steps and uses balanced keys/normalized pointers (no main GUI lookup); in autonomous mode each new model-selected intent needs meaningful alternatives. RPC/model overlap is not native execution proof; concurrencyEvidence keeps native intervals unknown unless separately measured by the game. Laya uses structured state only; OpenAI Decisions supports structured state plus actual viewport images for one player. OpenAI requests use server-side OPENAI_API_KEY and may transmit game observations/images to the official API. Visual mode requires one targeted client and screenshot files readable by the sidecar, with optional STUDIO_SCREENSHOT_REMOTE_ROOT/LOCAL_ROOT mapping. Continuous observation, stale-choice checks, bounded input, retained intents and the 15-second progress watchdog remain active. Results report the game outcome, the adapter's requirement checks (verification), diagnostics with hints, decisionEvidence and coverage separately, and repeatedFailure when the same harness keeps failing the same way. Requires stopped PIE and a validated harness. Success comes only from the adapter's observed game terminal, not a model estimate.`;
}

export function createRunTool(options: PlaytestToolOptions): Tool {
  return {
    name: toolName,
    description: describeRunTool(),
    parameters: runParams,
    async execute(args, ctx) {
      const parsed = runParams.parse(args);
      const mode = parsed.mode ?? "autonomous";
      const numberOfPlayer = parsed.numberOfPlayer ?? 1;
      const chooser: DecisionProvider | undefined =
        mode === "autonomous"
          ? await createDecisionProvider(
              {
                provider: parsed.decisionProvider ?? defaultDecisionProvider(),
                observationMode: parsed.observationMode ?? "structured",
                goal: parsed.goal,
                model: parsed.model,
                url: parsed.decisionUrl,
              },
              options.decisionOptions,
            )
          : undefined;
      const rpc = withSignal(options.callRpc, ctx);
      const asset = await readHarness(rpc, parsed.harnessName);
      if (!asset?.driverGuid) throw new Error("Install the Studio harness and its observation driver before running");
      const checked = await validate(rpc, [asset.moduleGuid, asset.driverGuid]);
      if (!checked.valid)
        throw new Error(`Harness validation did not pass; repair it before playing.\n${checked.output}`);
      const maxDurationMs = parsed.maxDurationMs ?? DEFAULT_RUN_DURATION_MS;
      const stuckTimeoutMs = parsed.stuckTimeoutMs ?? DEFAULT_STUCK_TIMEOUT_MS;
      const maxPhysicalBatchDurationMs = parsed.maxPhysicalBatchDurationMs ?? DEFAULT_PHYSICAL_BATCH_MS;
      if (
        !(await approve(ctx, toolName, `Start, play and stop Studio using ${parsed.harnessName}`, {
          harnessName: parsed.harnessName,
          mode,
          numberOfPlayer,
          maxDurationMs,
          ...(numberOfPlayer === 2 ? { maxPhysicalBatchDurationMs } : {}),
          stuckTimeoutMs,
          ...(chooser
            ? {
                decisionProvider: chooser.metadata.provider,
                observationMode: chooser.metadata.observationMode,
                endpoint: chooser.metadata.endpoint,
              }
            : {}),
        }))
      ) {
        return { output: "[Rejected by user]", metadata: { error: true } };
      }
      if (chooser) {
        ctx.onUpdate?.(`Preparing ${chooser.metadata.provider} for ${parsed.harnessName}...`);
        await chooser.prepare(ctx.signal);
      }
      const playtestsDirectory = join(options.cwd, ".overdare", "playtests");
      const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const directory = join(playtestsDirectory, runId);
      await mkdir(directory, { recursive: true });
      const tracePath = join(directory, "trace.jsonl");
      const decisionConfig = chooser
        ? { ...chooser.metadata, maxVisualAgeMs: parsed.maxVisualAgeMs ?? 2000 }
        : { provider: "none" as const, observationMode: "structured" as const };
      const runConfig = {
        mode,
        goal: parsed.goal,
        numberOfPlayer,
        ...(parsed.actorGoals ? { actorGoals: parsed.actorGoals } : {}),
        observationSource:
          numberOfPlayer === 2 ? "main_shared_authoritative_harness_actor_projection" : "main_targeted_harness",
        maxDurationMs,
        ...(numberOfPlayer === 2 ? { maxPhysicalBatchDurationMs } : {}),
        stuckTimeoutMs,
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
        mode,
        numberOfPlayer: parsed.numberOfPlayer,
        actorGoals: parsed.actorGoals,
        goal: parsed.goal,
        harnessId: parsed.harnessName,
        frameName: asset.frameName,
        maxDurationMs,
        maxPhysicalBatchDurationMs: parsed.maxPhysicalBatchDurationMs,
        stuckTimeoutMs: parsed.stuckTimeoutMs,
        intentDecisionIntervalMs: parsed.intentDecisionIntervalMs,
        signal: ctx.signal,
        ...(chooser ? { choose: chooser.choose, maxVisualAgeMs: parsed.maxVisualAgeMs } : {}),
        ...(chooser?.metadata.observationMode === "structured+image"
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
      for (const actor of Object.values(result.perActorEvidence ?? {})) {
        actor.source = { harnessName: asset.name, sourceHash: asset.sourceHash };
        actor.config = { ...decisionConfig, ...runConfig, goal: actor.goal };
      }
      if (writeFailure)
        throw new Error(`Playtest ended with ${result.outcome}, but trace persistence failed: ${String(writeFailure)}`);
      const repeatedFailure = await findRepeatedFailure({
        playtestsDirectory,
        currentRunId: runId,
        harnessName: asset.name,
        sourceHash: asset.sourceHash,
        result,
      });
      const summaryPath = join(directory, "summary.json");
      const coveragePath = join(directory, "coverage.json");
      const coverageResult = coverage.summary();
      const evidence = {
        ...result,
        harnessName: asset.name,
        sourceHash: asset.sourceHash,
        runId,
        decisionConfig,
        runConfig,
        coverage: coverageResult,
        ...(repeatedFailure ? { repeatedFailure } : {}),
        coveragePath,
        tracePath,
      };
      await writeFile(coveragePath, JSON.stringify(coverageResult, null, 2), "utf8");
      await writeFile(summaryPath, JSON.stringify(evidence, null, 2), "utf8");
      return {
        output: JSON.stringify({ ...evidence, summaryPath }, null, 2),
        metadata: { ...evidence, summaryPath },
      };
    },
  };
}
