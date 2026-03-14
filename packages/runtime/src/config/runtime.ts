// @summary Shared runtime config loader — single init path for both CLI and Web

import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { configureCompactionRegistry } from "@diligent/core/llm/compaction";
import { KNOWN_MODELS, resolveModel } from "@diligent/core/llm/models";
import { ProviderManager } from "@diligent/core/llm/provider-manager";
import type { Model, StreamFunction, SystemSection, ThinkingEffort } from "@diligent/core/llm/types";
import type { ModeKind } from "../agent/mode";
import type { PermissionEngine } from "../approval/index";
import { createPermissionEngine, createYoloPermissionEngine } from "../approval/index";
import { loadAuthStore, loadOAuthTokens, saveOAuthTokens } from "../auth/index";
import type { DiligentPaths } from "../infrastructure/index";
import { buildKnowledgeSection, readKnowledge } from "../knowledge/index";
import { buildBaseSystemPrompt } from "../prompt/index";
import type { SkillMetadata } from "../skills/index";
import { discoverSkills, renderSkillsSection } from "../skills/index";
import { buildSystemPromptWithKnowledge, discoverInstructions } from "./instructions";
import { loadDiligentConfig } from "./loader";
import type { DiligentConfig } from "./schema";

export interface RuntimeConfig {
  model: Model | undefined;
  effort: ThinkingEffort;
  mode: ModeKind;
  systemPrompt: SystemSection[];
  streamFunction: StreamFunction;
  diligent: DiligentConfig;
  sources: string[];
  skills: SkillMetadata[];
  compaction: {
    enabled: boolean;
    reservePercent: number;
    keepRecentTokens: number;
  };
  permissionEngine: PermissionEngine;
  providerManager: ProviderManager;
}

export async function loadRuntimeConfig(cwd: string, paths: DiligentPaths): Promise<RuntimeConfig> {
  const { config, sources } = await loadDiligentConfig(cwd);
  const instructions = await discoverInstructions(cwd);

  // Create ProviderManager — no throw on missing keys, deferred to call time
  const providerManager = new ProviderManager({
    ...config,
    onOAuthTokensRefreshed: saveOAuthTokens,
  });

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
  configureCompactionRegistry(providerManager.createNativeCompactionRegistry());

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
    const maxItems = config.knowledge?.maxItems;
    knowledgeSection = buildKnowledgeSection(knowledgeEntries, injectionBudget, maxItems);
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
  let basePrompt: string;
  if (config.systemPrompt) {
    basePrompt = config.systemPrompt;
  } else if (config.systemPromptFile) {
    const filePath = await resolveSystemPromptFile(config.systemPromptFile, sources);
    if (filePath) {
      basePrompt = (await readFile(filePath, "utf-8"))
        .replace(/\{\{currentDate\}\}/g, new Date().toISOString().split("T")[0])
        .replace(/\{\{cwd\}\}/g, cwd)
        .replace(/\{\{platform\}\}/g, process.platform);
    } else {
      console.warn(`[config] systemPromptFile "${config.systemPromptFile}" not found, using default`);
      basePrompt = buildBaseSystemPrompt({
        currentDate: new Date().toISOString().split("T")[0],
        cwd,
        platform: process.platform,
      });
    }
  } else {
    basePrompt = buildBaseSystemPrompt({
      currentDate: new Date().toISOString().split("T")[0],
      cwd,
      platform: process.platform,
    });
  }
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
    effort: (config.effort ?? "medium") as ThinkingEffort,
    systemPrompt,
    streamFunction,
    diligent: config,
    sources,
    skills,
    compaction: {
      enabled: config.compaction?.enabled ?? true,
      reservePercent: config.compaction?.reservePercent ?? 16,
      keepRecentTokens: config.compaction?.keepRecentTokens ?? 20000,
    },
    permissionEngine: config.yolo ? createYoloPermissionEngine() : createPermissionEngine(config.permissions ?? []),
    providerManager,
  };
}

/**
 * Resolve systemPromptFile path: absolute paths used as-is, relative paths
 * checked against each config file's directory first, then cwd as fallback.
 */
async function resolveSystemPromptFile(file: string, configSources: string[]): Promise<string | null> {
  if (isAbsolute(file)) {
    try {
      await access(file);
      return file;
    } catch {
      return null;
    }
  }

  for (const source of configSources) {
    const candidate = resolve(dirname(source), file);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // not found in this config dir, try next
    }
  }

  return null;
}
