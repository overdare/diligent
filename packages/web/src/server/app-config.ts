// @summary Web server runtime config loader for model, prompt, permissions, and stream function
import type { DiligentConfig, DiligentPaths, ModeKind, Model, StreamFunction, SystemSection } from "@diligent/core";
import {
  buildBaseSystemPrompt,
  buildKnowledgeSection,
  buildSystemPromptWithKnowledge,
  createPermissionEngine,
  discoverInstructions,
  discoverSkills,
  loadAuthStore,
  loadDiligentConfig,
  loadOAuthTokens,
  readKnowledge,
  renderSkillsSection,
  resolveModel,
} from "@diligent/core";
import { ProviderManager } from "./provider-manager";

export interface WebRuntimeConfig {
  model: Model;
  mode: ModeKind;
  systemPrompt: SystemSection[];
  streamFunction: StreamFunction;
  diligent: DiligentConfig;
  compaction: {
    enabled: boolean;
    reserveTokens: number;
    keepRecentTokens: number;
  };
  permissionEngine: ReturnType<typeof createPermissionEngine>;
}

export async function loadWebRuntimeConfig(cwd: string, paths: DiligentPaths): Promise<WebRuntimeConfig> {
  const { config } = await loadDiligentConfig(cwd);
  const instructions = await discoverInstructions(cwd);

  const modelId = config.model ?? "claude-sonnet-4-6";
  const model = resolveModel(modelId);

  const providerManager = new ProviderManager(config);

  const authKeys = await loadAuthStore();
  for (const [provider, key] of Object.entries(authKeys)) {
    if (typeof key === "string" && key) {
      providerManager.setApiKey(provider as "anthropic" | "openai" | "gemini", key);
    }
  }

  const oauthTokens = await loadOAuthTokens();
  if (oauthTokens) {
    providerManager.setOAuthTokens(oauthTokens);
    await providerManager.ensureOAuthFresh();
  }

  const streamFunction = providerManager.createProxyStream();

  let knowledgeSection = "";
  const knowledgeEnabled = config.knowledge?.enabled ?? true;
  if (knowledgeEnabled) {
    const knowledgeEntries = await readKnowledge(paths.knowledge);
    const injectionBudget = config.knowledge?.injectionBudget ?? 8192;
    knowledgeSection = buildKnowledgeSection(knowledgeEntries, injectionBudget);
  }

  let skillsSection = "";
  const skillsEnabled = config.skills?.enabled ?? true;
  if (skillsEnabled) {
    const result = await discoverSkills({
      cwd,
      additionalPaths: config.skills?.paths,
    });
    skillsSection = renderSkillsSection(result.skills);
  }

  const basePrompt =
    config.systemPrompt ??
    buildBaseSystemPrompt({
      currentDate: new Date().toISOString().split("T")[0],
      cwd,
      platform: process.platform,
    });

  const systemPrompt = buildSystemPromptWithKnowledge(
    basePrompt,
    instructions,
    knowledgeSection,
    config.instructions,
    skillsSection,
  );

  return {
    model,
    mode: (config.mode ?? "default") as ModeKind,
    systemPrompt,
    streamFunction,
    diligent: config,
    compaction: {
      enabled: config.compaction?.enabled ?? true,
      reserveTokens: config.compaction?.reserveTokens ?? 16384,
      keepRecentTokens: config.compaction?.keepRecentTokens ?? 20000,
    },
    permissionEngine: createPermissionEngine(config.permissions ?? []),
  };
}
