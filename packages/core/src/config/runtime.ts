// @summary Shared runtime config loader — single init path for both CLI and Web

import type { ModeKind } from "../agent/index";
import type { PermissionEngine } from "../approval/index";
import { createPermissionEngine } from "../approval/index";
import { loadAuthStore, loadOAuthTokens } from "../auth/auth-store";
import type { DiligentPaths } from "../infrastructure/index";
import { buildKnowledgeSection, readKnowledge } from "../knowledge/index";
import { buildBaseSystemPrompt } from "../prompt/index";
import { KNOWN_MODELS, resolveModel } from "../provider/models";
import { ProviderManager } from "../provider/provider-manager";
import type { Model, StreamFunction, SystemSection } from "../provider/types";
import type { SkillMetadata } from "../skills/index";
import { discoverSkills, renderSkillsSection } from "../skills/index";
import { buildSystemPromptWithKnowledge, discoverInstructions } from "./instructions";
import { loadDiligentConfig } from "./loader";
import type { DiligentConfig } from "./schema";

export interface RuntimeConfig {
  model: Model | undefined;
  mode: ModeKind;
  systemPrompt: SystemSection[];
  streamFunction: StreamFunction;
  diligent: DiligentConfig;
  sources: string[];
  skills: SkillMetadata[];
  compaction: { enabled: boolean; reserveTokens: number; keepRecentTokens: number };
  permissionEngine: PermissionEngine;
  providerManager: ProviderManager;
}

export async function loadRuntimeConfig(cwd: string, paths: DiligentPaths): Promise<RuntimeConfig> {
  const { config, sources } = await loadDiligentConfig(cwd);
  const instructions = await discoverInstructions(cwd);

  // Create ProviderManager — no throw on missing keys, deferred to call time
  const providerManager = new ProviderManager(config);

  // Overlay auth.json keys
  const authKeys = await loadAuthStore();
  for (const [provider, key] of Object.entries(authKeys)) {
    if (typeof key === "string" && key) {
      providerManager.setApiKey(provider as "anthropic" | "openai" | "gemini", key);
    }
  }

  // Load OpenAI OAuth tokens — takes priority over plain key if present
  const oauthTokens = await loadOAuthTokens();
  if (oauthTokens) {
    providerManager.setOAuthTokens(oauthTokens);
    await providerManager.ensureOAuthFresh();
  }

  const streamFunction = providerManager.createProxyStream();

  // Resolve model: use config.model if set, otherwise pick first available from configured providers
  const configured = providerManager.getConfiguredProviders();
  const firstAvailable = KNOWN_MODELS.find((m) => configured.includes(m.provider as "anthropic" | "openai" | "gemini"));
  const modelId = config.model ?? firstAvailable?.id;
  const model = modelId ? resolveModel(modelId) : undefined;

  // Load knowledge for system prompt injection
  let knowledgeSection = "";
  const knowledgeEnabled = config.knowledge?.enabled ?? true;
  if (knowledgeEnabled) {
    const knowledgeEntries = await readKnowledge(paths.knowledge);
    const injectionBudget = config.knowledge?.injectionBudget ?? 8192;
    knowledgeSection = buildKnowledgeSection(knowledgeEntries, injectionBudget);
  }

  // Load skills
  let skills: SkillMetadata[] = [];
  let skillsSection = "";
  const skillsEnabled = config.skills?.enabled ?? true;
  if (skillsEnabled) {
    const result = await discoverSkills({
      cwd,
      additionalPaths: config.skills?.paths,
    });
    skills = result.skills;
    skillsSection = renderSkillsSection(skills);
  }

  // Build system prompt with knowledge AND skills
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
    sources,
    skills,
    compaction: {
      enabled: config.compaction?.enabled ?? true,
      reserveTokens: config.compaction?.reserveTokens ?? 16384,
      keepRecentTokens: config.compaction?.keepRecentTokens ?? 20000,
    },
    permissionEngine: createPermissionEngine(config.permissions ?? []),
    providerManager,
  };
}
