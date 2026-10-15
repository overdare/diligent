// @summary Defines the Studio playtest episode runner and persisted evidence output.
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Tool } from "../../types";
import { createCoverageTracker } from "./coverage";
import { createDecisionProvider } from "./decision-provider";
import { readHarness } from "./harness";
import { DEFAULT_INTENT_DECISION_INTERVAL_MS, DEFAULT_STUCK_TIMEOUT_MS, runPlaytest } from "./runtime";
import { approve, type PlaytestToolOptions, runParams, validate, withSignal } from "./tool-shared";
import { createVisualObserver } from "./visual-observation";

const toolName = "studiorpc_game_playtest";
const description =
  "Start a fresh Studio play session, run an editable UGC harness with the selected decision provider, observe effects, then stop the same session. Default Laya uses structured state; OpenAI Decisions supports structured state plus actual viewport images. OpenAI requests use server-side OPENAI_API_KEY and may transmit game observations/images to the official API. Visual mode requires one targeted client and screenshot files readable by the sidecar, with optional STUDIO_SCREENSHOT_REMOTE_ROOT/LOCAL_ROOT mapping. Continuous observation, stale-choice checks, bounded input, retained intents and the 15-second progress watchdog remain active. Captures happen at model-decision boundaries, not every input step; singleton and retained steps are automatic. Records provider settings, visual metadata/artifacts and actual results. Requires stopped PIE and a validated harness. Success comes only from the adapter's observed game terminal, not a model estimate.";

export function createRunTool(options: PlaytestToolOptions): Tool {
  return {
    name: toolName,
    description,
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
        !(await approve(ctx, toolName, `Start, play and stop Studio using ${parsed.harnessName}`, {
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
}
