// @summary Product-injected experiment definitions and coupled capability resolution.

export interface ExperimentDefinition {
  id: string;
  title: string;
  description: string;
  defaultEnabled: boolean;
  toolNames?: readonly string[];
  skillNames?: readonly string[];
  agentNames?: readonly string[];
  /**
   * Product side effect for a settings change made through experiments/set. Called after the new state is
   * persisted and reloaded, only when the resolved enabled state actually changed. Not awaited by the request:
   * a slow or failing effect never blocks or rejects the settings save, so products must keep their own
   * on-use fallback for states changed by editing config directly.
   */
  onEnabledChange?: (enabled: boolean) => void | Promise<void>;
}

export interface ResolvedExperiment extends ExperimentDefinition {
  enabled: boolean;
}

export function resolveExperimentStates(
  definitions: readonly ExperimentDefinition[],
  overrides: Readonly<Record<string, boolean>> | undefined,
): ResolvedExperiment[] {
  return definitions.map((definition) => ({
    ...definition,
    enabled: overrides?.[definition.id] ?? definition.defaultEnabled,
  }));
}

export function resolveExperimentGates(states: readonly ResolvedExperiment[]): {
  disabledToolNames: Set<string>;
  disabledSkillNames: Set<string>;
  disabledAgentNames: Set<string>;
} {
  const disabledToolNames = new Set<string>();
  const disabledSkillNames = new Set<string>();
  const disabledAgentNames = new Set<string>();
  for (const state of states) {
    if (state.enabled) continue;
    for (const name of state.toolNames ?? []) disabledToolNames.add(name);
    for (const name of state.skillNames ?? []) disabledSkillNames.add(name);
    for (const name of state.agentNames ?? []) disabledAgentNames.add(name);
  }
  return { disabledToolNames, disabledSkillNames, disabledAgentNames };
}
