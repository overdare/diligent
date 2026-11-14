// @summary Product experiment list/set handlers with atomic coupled capability persistence.

import { createLogger } from "@diligent/logging";
import { getGlobalConfigPath, saveGlobalExperimentOverrides } from "../config";
import type { ExperimentDefinition, ResolvedExperiment } from "../experiments";
import type { ExperimentsListResponse, ExperimentsSetParams } from "../protocol";
import type { ConfigReloadResult } from "./config-handlers";
import { handleConfigReload } from "./config-handlers";
import type { ThreadRuntime } from "./thread-handlers";

const logger = createLogger({ scope: "runtime.experiments" });

export interface ExperimentConfigManager {
  getDefinitions: () => ExperimentDefinition[];
  getExperiments: () => ResolvedExperiment[];
}

export function handleExperimentsList(manager: ExperimentConfigManager): ExperimentsListResponse {
  return buildResponse(manager.getExperiments());
}

export async function handleExperimentsSet(
  manager: ExperimentConfigManager,
  reloadConfig: (() => Promise<ConfigReloadResult>) | undefined,
  threads: Map<string, ThreadRuntime>,
  params: ExperimentsSetParams,
  goalsEnabled: () => boolean = () => true,
): Promise<ExperimentsListResponse> {
  const definitions = manager.getDefinitions();
  const knownIds = new Set(definitions.map((definition) => definition.id));
  const unknownIds = Object.keys(params.overrides).filter((id) => !knownIds.has(id));
  if (unknownIds.length > 0) {
    throw Object.assign(new Error(`Unknown experiment(s): ${unknownIds.sort().join(", ")}`), { code: -32602 });
  }
  const stored = Object.fromEntries(
    definitions
      .filter((definition) => params.overrides[definition.id] !== undefined)
      .filter((definition) => params.overrides[definition.id] !== definition.defaultEnabled)
      .map((definition) => [definition.id, params.overrides[definition.id]!]),
  );
  const before = new Map(manager.getExperiments().map((experiment) => [experiment.id, experiment.enabled]));
  await saveGlobalExperimentOverrides(stored);
  await handleConfigReload(reloadConfig, threads, goalsEnabled);
  const after = manager.getExperiments();
  for (const experiment of after) {
    if (before.get(experiment.id) !== experiment.enabled) notifyEnabledChange(experiment);
  }
  return buildResponse(after);
}

function notifyEnabledChange(experiment: ResolvedExperiment): void {
  const hook = experiment.onEnabledChange;
  if (!hook) return;
  // The save already succeeded; a product side effect must not turn it into a failed request.
  Promise.resolve()
    .then(() => hook(experiment.enabled))
    .catch((error: unknown) => {
      logger.warn("experiment_side_effect_failed", {
        message: `[experiments] ${experiment.id} ${experiment.enabled ? "enable" : "disable"} side effect failed`,
        error,
        fields: { experimentId: experiment.id, enabled: experiment.enabled },
      });
    });
}

function buildResponse(experiments: readonly ResolvedExperiment[]): ExperimentsListResponse {
  return {
    configPath: getGlobalConfigPath(),
    appliesOnNextTurn: true,
    experiments: experiments.map(({ id, title, description, defaultEnabled, enabled }) => ({
      id,
      title,
      description,
      defaultEnabled,
      enabled,
    })),
  };
}
