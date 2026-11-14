export interface SkillMetadata {
  /** Skill name — kebab-case, defined by frontmatter */
  name: string;
  /** Human-readable description */
  description: string;
  /** Absolute path to SKILL.md file */
  path: string;
  /** Directory containing the SKILL.md */
  baseDir: string;
  /** Where this skill was discovered */
  source: "global" | "project" | "config";
  /** Whether the LLM can autonomously decide to use this skill */
  disableModelInvocation: boolean;
  /** Global launcher policy to recheck when a cached skill is invoked. */
  revocationStatePath?: string;
}

export interface SkillLoadResult {
  skills: SkillMetadata[];
  errors: SkillLoadError[];
}

export interface SkillLoadError {
  path: string;
  message: string;
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  "disable-model-invocation"?: boolean;
}
