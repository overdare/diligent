// @summary Loads and validates the CLI configuration from disk
import type {
  AgentEvent,
  AgentLoopConfig,
  DiligentConfig,
  DiligentPaths,
  EventStream,
  Message,
  ModeKind,
  Model,
  SkillMetadata,
  StreamFunction,
} from "@diligent/core";
import {
  buildBaseSystemPrompt,
  buildKnowledgeSection,
  buildSystemPromptWithKnowledge,
  discoverInstructions,
  discoverSkills,
  loadAuthStore,
  loadDiligentConfig,
  readKnowledge,
  renderSkillsSection,
  resolveModel,
} from "@diligent/core";
import { ProviderManager, type ProviderName } from "./provider-manager";

export type AgentLoopFn = (messages: Message[], config: AgentLoopConfig) => EventStream<AgentEvent, Message[]>;

export interface AppConfig {
  apiKey: string;
  model: Model;
  systemPrompt: string;
  streamFunction: StreamFunction;
  diligent: DiligentConfig;
  sources: string[];
  agentLoopFn?: AgentLoopFn;
  skills: SkillMetadata[];
  mode: ModeKind; // D087: always set, defaults to "default"
  providerManager: ProviderManager;
}

export async function loadConfig(cwd: string = process.cwd(), paths?: DiligentPaths): Promise<AppConfig> {
  const { config, sources } = await loadDiligentConfig(cwd);
  const instructions = await discoverInstructions(cwd);

  // Resolve model from config or default
  const modelId = config.model ?? "claude-sonnet-4-6";
  const model = resolveModel(modelId);

  // Create ProviderManager — no throw on missing keys, deferred to call time
  const providerManager = new ProviderManager(config);

  // Overlay auth.json keys (takes priority over config)
  const authKeys = await loadAuthStore();
  for (const [provider, key] of Object.entries(authKeys)) {
    if (key) providerManager.setApiKey(provider as ProviderName, key);
  }

  const streamFunction = providerManager.createProxyStream();

  // Backward-compatible apiKey: current provider's key or empty string
  const provider = (model.provider ?? "anthropic") as "anthropic" | "openai";
  const apiKey = providerManager.getApiKey(provider) ?? "";

  // Load knowledge for system prompt injection
  let knowledgeSection = "";
  if (paths) {
    const knowledgeEnabled = config.knowledge?.enabled ?? true;
    if (knowledgeEnabled) {
      const knowledgeEntries = await readKnowledge(paths.knowledge);
      const injectionBudget = config.knowledge?.injectionBudget ?? 8192;
      knowledgeSection = buildKnowledgeSection(knowledgeEntries, injectionBudget);
    }
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
    apiKey,
    model,
    systemPrompt,
    streamFunction,
    diligent: config,
    sources,
    skills,
    mode: (config.mode ?? "default") as ModeKind,
    providerManager,
  };
}
