// @summary Runs the runtime task/profile matrix sequentially into one report, optionally as a capability matrix

import { arch, platform } from "node:os";
import { resolveModel } from "@diligent/core/model-registry";
import type { ProviderManager, StreamFunction } from "@diligent/core/provider-contract";
import {
  authPathForProvider,
  type CapabilityCell,
  type CapabilityCostPolicy,
  capabilitySupport,
  classifyCapabilityExecution,
  countCapabilityCells,
  type RuntimeCapabilityMatrix,
} from "../capabilities";
import type {
  AnyRuntimeEvalTask,
  RuntimeEvalExecutionReport,
  RuntimeEvalExecutionResult,
  RuntimeEvalSuiteReport,
} from "../runtime-task";
import { aggregateEvalStatuses, type EvalProfile } from "../task";
import { runRuntimeEvalExecution } from "./runtime-execution";
import { deriveTaskSeed } from "./seed";
import type { EvalRunMetadata } from "./suite";

export interface CapabilityUnavailable {
  code: string;
  reason: string;
}

/** Catalog-wide capability run: every task carries a `capability` tag and each task/profile pair is a matrix cell. */
export interface RuntimeCapabilityMatrixOptions {
  /** Credential or environment problem that prevents any live call for the profile's provider. */
  unavailable(profile: EvalProfile): CapabilityUnavailable | undefined;
  /** Skip reason for cells excluded by cost; omit to run every supported cell. */
  costPolicy?: CapabilityCostPolicy;
  onCell?: (cell: CapabilityCell) => void;
}

export async function runRuntimeEvalSuite(input: {
  tasks: readonly AnyRuntimeEvalTask[];
  profiles: readonly EvalProfile[];
  rootSeed: string;
  metadata: EvalRunMetadata;
  createStream(profile: EvalProfile): StreamFunction;
  configureProviderManager?: (profile: EvalProfile, manager: ProviderManager) => void;
  matrix?: RuntimeCapabilityMatrixOptions;
  execute?: typeof runRuntimeEvalExecution;
  onExecutionStart?: (task: AnyRuntimeEvalTask, profile: EvalProfile) => void;
  onExecutionEnd?: (result: RuntimeEvalExecutionResult) => void;
}): Promise<RuntimeEvalSuiteReport> {
  validate(input.tasks, input.profiles, input.matrix !== undefined);
  const execute = input.execute ?? runRuntimeEvalExecution;
  const startedAt = new Date();
  const executions: RuntimeEvalExecutionReport[] = [];
  const cells: CapabilityCell[] = [];
  const unavailable = new Map(input.profiles.map((profile) => [profile, input.matrix?.unavailable(profile)]));
  for (const task of input.tasks) {
    const taskSeed = deriveTaskSeed(input.rootSeed, task.id);
    for (const profile of input.profiles) {
      const capability = task.capability;
      let identity: Omit<CapabilityCell, "status"> | undefined;
      if (input.matrix && capability) {
        const model = resolveModel({ provider: profile.provider, modelId: profile.model });
        identity = {
          provider: profile.provider,
          authPath: authPathForProvider(profile.provider),
          model: profile.model,
          capability,
          taskId: task.id,
        };
        const support = capabilitySupport(model, capability);
        const skipReason = support.supported ? input.matrix.costPolicy?.(model, capability) : undefined;
        const blocked = unavailable.get(profile);
        let cell: CapabilityCell | undefined;
        if (!support.supported) cell = { ...identity, status: "unsupported", reason: support.reason };
        else if (skipReason) cell = { ...identity, status: "skipped", reason: skipReason };
        else if (blocked) cell = { ...identity, status: "not_run", ...blocked };
        if (cell) {
          cells.push(cell);
          input.matrix.onCell?.(cell);
          continue;
        }
      }
      input.onExecutionStart?.(task, profile);
      const result = await execute({
        task,
        profile,
        seed: taskSeed,
        streamFunction: input.createStream(profile),
        configureProviderManager: input.configureProviderManager,
      });
      executions.push(toRuntimeExecutionReport(task, taskSeed, result));
      input.onExecutionEnd?.(result);
      if (identity) {
        const cell: CapabilityCell = {
          ...identity,
          ...classifyCapabilityExecution(result),
          elapsedMs: result.execution.elapsedMs,
        };
        cells.push(cell);
        input.matrix?.onCell?.(cell);
      }
    }
  }
  const matrix: RuntimeCapabilityMatrix | undefined = input.matrix
    ? {
        capabilities: input.tasks.flatMap((task) => (task.capability ? [task.capability] : [])),
        cells,
        counts: countCapabilityCells(cells),
      }
    : undefined;
  return {
    schemaVersion: 1,
    suite: "runtime",
    suiteVersion: "runtime-v0",
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
    profiles: input.profiles.map((profile) => ({ ...profile })),
    taskIds: input.tasks.map((task) => task.id),
    // Not-run cells have no execution, so they must fail the run explicitly.
    passed: executions.every((execution) => execution.passed) && (matrix?.counts.not_run ?? 0) === 0,
    status: aggregateEvalStatuses(executions.map((execution) => execution.status)),
    executions,
    ...(matrix && { matrix }),
  };
}

export function toRuntimeExecutionReport(
  task: AnyRuntimeEvalTask,
  taskSeed: string,
  result: RuntimeEvalExecutionResult,
): RuntimeEvalExecutionReport {
  const { compactions, childSessions, ...execution } = result.execution;
  return {
    ...execution,
    taskSeed,
    fixtureVersion: task.fixtureVersion,
    limits: task.limits,
    passed: result.passed,
    status: result.status,
    ...(result.failure && { failure: result.failure }),
    failures: result.failures,
    ...(result.diagnostics?.length && { diagnostics: result.diagnostics }),
    ...(compactions.length > 0 && { compactions }),
    ...(childSessions.length > 0 && { childSessions }),
    world: result.worldSnapshot,
  };
}

function validate(tasks: readonly AnyRuntimeEvalTask[], profiles: readonly EvalProfile[], matrix: boolean): void {
  if (tasks.length === 0 || profiles.length === 0) throw new Error("Runtime eval selection cannot be empty.");
  if (new Set(tasks.map((task) => task.id)).size !== tasks.length) throw new Error("Duplicate runtime eval task ID.");
  if (matrix && tasks.some((task) => !task.capability))
    throw new Error("A capability matrix run accepts only capability-tagged tasks.");
}
