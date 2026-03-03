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
  SystemSection,
} from "@diligent/core";
import { ensureDiligentDir, loadRuntimeConfig, resolveModel } from "@diligent/core";
import type { ProviderManager, ProviderName } from "./provider-manager";

export type AgentLoopFn = (messages: Message[], config: AgentLoopConfig) => EventStream<AgentEvent, Message[]>;

export interface AppConfig {
  apiKey: string;
  model: Model;
  systemPrompt: SystemSection[];
  streamFunction: StreamFunction;
  diligent: DiligentConfig;
  sources: string[];
  agentLoopFn?: AgentLoopFn;
  skills: SkillMetadata[];
  mode: ModeKind; // D087: always set, defaults to "default"
  compaction: { enabled: boolean; reserveTokens: number; keepRecentTokens: number };
  providerManager: ProviderManager;
}

export async function loadConfig(cwd: string = process.cwd(), paths?: DiligentPaths): Promise<AppConfig> {
  const resolvedPaths = paths ?? (await ensureDiligentDir(cwd));
  const runtime = await loadRuntimeConfig(cwd, resolvedPaths);
  // CLI default: claude-sonnet-4-6 when no provider is configured
  const model = runtime.model ?? resolveModel("claude-sonnet-4-6");
  const provider = (model.provider ?? "anthropic") as ProviderName;
  const apiKey = runtime.providerManager.getApiKey(provider) ?? "";

  return {
    apiKey,
    model,
    systemPrompt: runtime.systemPrompt,
    streamFunction: runtime.streamFunction,
    diligent: runtime.diligent,
    sources: runtime.sources,
    skills: runtime.skills,
    mode: runtime.mode,
    compaction: runtime.compaction,
    providerManager: runtime.providerManager,
  };
}
