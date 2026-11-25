// @summary Runs every selected model against every selected capability probe into one matrix report

import { arch, platform } from "node:os";
import { resolveModel } from "@diligent/core/model-registry";
import type { ProviderManager, StreamFunction } from "@diligent/core/provider-contract";
import {
  authPathForProvider,
  type CapabilityCell,
  type CapabilityMatrixReport,
  capabilitySupport,
  classifyCapabilityExecution,
  countCapabilityCells,
  type ModelCapability,
} from "../capabilities";
import type { RuntimeEvalExecutionReport } from "../runtime-task";
import type { EvalProfile } from "../task";
import { CAPABILITY_TASKS } from "../tasks/capabilities";
import { runRuntimeEvalExecution } from "./runtime-execution";
import { toRuntimeExecutionReport } from "./runtime-suite";
import { deriveTaskSeed } from "./seed";
import type { EvalRunMetadata } from "./suite";

export interface CapabilityUnavailable {
  code: string;
  reason: string;
}

export async function runCapabilitySuite(input: {
  profiles: readonly EvalProfile[];
  capabilities: readonly ModelCapability[];
  rootSeed: string;
  metadata: EvalRunMetadata;
  /** Credential or environment problem that prevents any live call for the profile's provider. */
  unavailable(profile: EvalProfile): CapabilityUnavailable | undefined;
  createStream(profile: EvalProfile): StreamFunction;
  configureProviderManager(profile: EvalProfile, manager: ProviderManager): void;
  execute?: typeof runRuntimeEvalExecution;
  onCellStart?: (profile: EvalProfile, capability: ModelCapability) => void;
  onCellEnd?: (cell: CapabilityCell) => void;
}): Promise<CapabilityMatrixReport> {
  if (input.profiles.length === 0 || input.capabilities.length === 0)
    throw new Error("Capability eval selection cannot be empty.");
  const execute = input.execute ?? runRuntimeEvalExecution;
  const startedAt = new Date();
  const cells: CapabilityCell[] = [];
  const executions: RuntimeEvalExecutionReport[] = [];
  for (const profile of input.profiles) {
    const model = resolveModel({ provider: profile.provider, modelId: profile.model });
    const unavailable = input.unavailable(profile);
    for (const capability of input.capabilities) {
      const identity = {
        provider: profile.provider,
        authPath: authPathForProvider(profile.provider),
        model: profile.model,
        capability,
      };
      const support = capabilitySupport(model, capability);
      let cell: CapabilityCell;
      if (!support.supported) {
        cell = { ...identity, status: "unsupported", reason: support.reason };
      } else if (unavailable) {
        cell = { ...identity, status: "not_run", ...unavailable };
      } else {
        const task = CAPABILITY_TASKS[capability];
        const taskSeed = deriveTaskSeed(input.rootSeed, task.id);
        input.onCellStart?.(profile, capability);
        const result = await execute({
          task,
          profile,
          seed: taskSeed,
          streamFunction: input.createStream(profile),
          configureProviderManager: input.configureProviderManager,
        });
        executions.push(toRuntimeExecutionReport(task, taskSeed, result));
        cell = {
          ...identity,
          ...classifyCapabilityExecution(result),
          taskId: task.id,
          elapsedMs: result.execution.elapsedMs,
        };
      }
      cells.push(cell);
      input.onCellEnd?.(cell);
    }
  }
  const counts = countCapabilityCells(cells);
  return {
    schemaVersion: 1,
    suite: "capabilities",
    suiteVersion: "capabilities-v1",
    repository: input.metadata.repository,
    commitSha: input.metadata.commitSha,
    ref: input.metadata.ref,
    runId: input.metadata.runId,
    runAttempt: input.metadata.runAttempt,
    bunVersion: input.metadata.bunVersion,
    os: platform(),
    architecture: arch(),
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    rootSeed: input.rootSeed,
    providers: [...new Set(input.profiles.map((profile) => profile.provider))],
    capabilities: [...input.capabilities],
    cells,
    counts,
    passed: counts.fail === 0 && counts.not_run === 0,
    executions,
  };
}
