// @summary Resolves layered config gates for discovered skills.

import { createLogger } from "@diligent/logging";
import type { DiligentConfigLayers } from "../config/loader";
import type { DiligentConfig } from "../config/schema";
import { discoverSkills } from "./discovery";
import type { SkillLoadError, SkillMetadata } from "./types";

const logger = createLogger({ scope: "runtime.skills" });

export type SkillStateReason = "enabled" | "disabled_by_user" | "skills_disabled";
export type SkillSettingController = "default" | "global" | "project";

export interface ResolvedSkillState {
  skill: SkillMetadata;
  globalEnabled: boolean;
  effectiveEnabled: boolean;
  available: boolean;
  controlledBy: SkillSettingController;
  reason: SkillStateReason;
}

export function resolveSkillsEnabledControl(layers: DiligentConfigLayers): SkillSettingController {
  if (layers.project?.skills?.enabled !== undefined) return "project";
  if (layers.global?.skills?.enabled !== undefined) return "global";
  return "default";
}

export function resolveSkillStates(
  skills: SkillMetadata[],
  resolvedConfig: DiligentConfig["skills"] | undefined,
  layers: DiligentConfigLayers,
): ResolvedSkillState[] {
  const skillsEnabled = resolvedConfig?.enabled ?? true;
  const globalOverrides = layers.global?.skills?.overrides ?? {};
  const projectOverrides = layers.project?.skills?.overrides ?? {};
  const effectiveOverrides = resolvedConfig?.overrides ?? {};

  return skills.map((skill) => {
    const globalEnabled = globalOverrides[skill.name] ?? true;
    const effectiveEnabled = effectiveOverrides[skill.name] ?? true;
    let controlledBy: SkillSettingController;
    if (Object.hasOwn(projectOverrides, skill.name)) {
      controlledBy = "project";
    } else {
      controlledBy = Object.hasOwn(globalOverrides, skill.name) ? "global" : "default";
    }
    const available = skillsEnabled && effectiveEnabled;
    let reason: SkillStateReason;
    if (!skillsEnabled) {
      reason = "skills_disabled";
    } else {
      reason = effectiveEnabled ? "enabled" : "disabled_by_user";
    }

    return {
      skill,
      globalEnabled,
      effectiveEnabled,
      available,
      controlledBy,
      reason,
    };
  });
}

export function filterAvailableSkills(states: ResolvedSkillState[]): SkillMetadata[] {
  return states.filter((state) => state.available).map((state) => state.skill);
}

export interface ActiveSkillsOptions {
  cwd: string;
  config: DiligentConfig["skills"] | undefined;
  layers: DiligentConfigLayers;
  disabledSkillNames?: ReadonlySet<string>;
}

export interface ActiveSkills {
  discovered: SkillMetadata[];
  skills: SkillMetadata[];
  errors: SkillLoadError[];
}

/** Discover skills on disk for `cwd` and keep the ones layered config and experiment gates allow. */
export async function loadActiveSkills(options: ActiveSkillsOptions): Promise<ActiveSkills> {
  const { cwd, config, layers, disabledSkillNames } = options;
  const { skills: discovered, errors } = await discoverSkills({ cwd, additionalPaths: config?.paths });
  for (const error of errors) {
    logger.warn("skill_load_failed", {
      message: `[skills] Skipped ${error.path}: ${error.message}`,
      fields: { path: error.path },
    });
  }
  const skills = filterAvailableSkills(resolveSkillStates(discovered, config, layers)).filter(
    (skill) => !disabledSkillNames?.has(skill.name),
  );
  return { discovered, skills, errors };
}
