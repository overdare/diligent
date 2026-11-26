// @summary Factory that builds a DiligentAppServerConfig from a RuntimeConfig, eliminating Web/CLI duplication
import { dirname, join } from "node:path";
import type { AgentLoopHook } from "@diligent/core/agent";
import { getModelInfoList, resolveModel } from "@diligent/core/model-registry";
import type { ProviderName, SystemSection } from "@diligent/core/provider-contract";
import { resolveMaxTokens } from "@diligent/core/provider-contract";
import type { Tool, ToolOutputFileStore } from "@diligent/core/tool-contract";
import { createLogger } from "@diligent/logging";
import { createMemoryNudge } from "../agent/memory-nudge";
import {
  EXECUTE_MODE_DISALLOWED_TOOLS,
  MODE_SYSTEM_PROMPT_SUFFIXES,
  type Mode,
  PLAN_MODE_DISALLOWED_TOOLS,
} from "../agent/mode";
import { createPlanReminder } from "../agent/plan-reminder";
import { createReminderHook } from "../agent/reminder-hook";
import { RuntimeAgent } from "../agent/runtime-agent";
import { openBrowser as defaultOpenBrowser } from "../auth";
import { loadDiligentConfig } from "../config/loader";
import { loadRuntimeConfig, type RuntimeConfig } from "../config/runtime";
import { getGlobalConfigPath, saveGlobalModel } from "../config/writer";
import { createGoalContextHook } from "../goals/tools";
import { createLocalImageLoader, type DiligentPaths, ensureDiligentDir, toolOutputStore } from "../infrastructure";
import { loadMemorySection } from "../memory";
import { withToolInstructions } from "../prompt/tool-instructions";
import { type ActiveSkills, loadActiveSkills, renderSkillsSection, type SkillMetadata } from "../skills";
import {
  type BundledToolProvider,
  createBundledAgentLoopHooks,
  type TextGenerationFn,
} from "../tools/bundled-provider";
import { createRuntimeToolHost } from "../tools/capabilities";
import { CodeModeSession } from "../tools/code-mode/session";
import { applyCodeMode } from "../tools/code-mode/tools";
import { buildDefaultTools } from "../tools/defaults";
import { buildMcpNeedsAuthNote, getMcpManager } from "../tools/mcp";
import type { PluginDiscoveryMode } from "../tools/plugin-loader";
import { ShellProcessRegistry } from "../tools/shell-processes";
import type { ConfigReloadResult } from "./config-handlers";
import type { CreateAgentArgs, DiligentAppServerConfig } from "./server";

const logger = createLogger({ scope: "runtime.app-server.config" });

const SKILL_SECTION_SUCCESSORS = new Set(["agents", "instructions", "additional"]);

const SKILL_USAGE_GUARDRAIL: SystemSection = {
  label: "skill_usage_guardrail",
  content: [
    "Skills must be loaded through the skill tool.",
    "Do not use read to open SKILL.md directly.",
    "When the user names an available skill or the task matches its cataloged workflow, call skill first. Related keywords alone are not a match.",
  ].join("\n"),
};

/** Replace any earlier skill catalog in the prompt with the skills discovered for this agent. */
function withSkills(systemPrompt: SystemSection[], skills: SkillMetadata[]): SystemSection[] {
  const withoutGuardrail = systemPrompt.filter((section) => section.label !== SKILL_USAGE_GUARDRAIL.label);
  const previousIndex = withoutGuardrail.findIndex((section) => section.label === "skills");
  const sections = withoutGuardrail.filter((section) => section.label !== "skills");
  const content = renderSkillsSection(skills);
  if (!content) return skills.length === 0 ? sections : [...sections, SKILL_USAGE_GUARDRAIL];

  const successorIndex = sections.findIndex((section) => SKILL_SECTION_SUCCESSORS.has(section.label));
  const insertAt = [previousIndex, successorIndex].find((index) => index >= 0) ?? sections.length;
  return sections.toSpliced(insertAt, 0, { label: "skills", content });
}

function applyModeToPrompt(mode: Mode, systemPrompt: RuntimeConfig["systemPrompt"]) {
  if (mode === "default") {
    return systemPrompt;
  }
  return [...systemPrompt, { tag: "collaboration_mode", label: "mode", content: MODE_SYSTEM_PROMPT_SUFFIXES[mode] }];
}

/**
 * Read the persistent memory store at agent creation time, so every newly started session
 * receives memory saved after the app server itself started.
 */
async function withLatestMemory(
  systemPrompt: SystemSection[],
  paths: DiligentPaths,
  memoryConfig: RuntimeConfig["diligent"]["memory"],
): Promise<SystemSection[]> {
  const withoutMemory = systemPrompt.filter((section) => section.label !== "memory");
  const content = await loadMemorySection(paths.memory, memoryConfig);
  if (!content) return withoutMemory;

  const memorySection: SystemSection = {
    tag: "memory",
    label: "memory",
    content,
    cacheControl: "ephemeral",
  };
  const baseIndex = withoutMemory.findIndex((section) => section.label === "base");
  const insertAt = baseIndex < 0 ? 0 : baseIndex + 1;
  return [...withoutMemory.slice(0, insertAt), memorySection, ...withoutMemory.slice(insertAt)];
}

export function filterToolsByMode(mode: Mode, tools: Awaited<ReturnType<typeof buildDefaultTools>>["tools"]) {
  if (mode === "plan") {
    return tools.filter((tool) => !PLAN_MODE_DISALLOWED_TOOLS.has(tool.name));
  }
  if (mode === "execute") {
    return tools.filter((tool) => !EXECUTE_MODE_DISALLOWED_TOOLS.has(tool.name));
  }
  return tools;
}

/**
 * Append a system-prompt section listing MCP servers that need interactive login, so the agent can
 * tell the user to run `/mcp login <name>` rather than trying (and failing) to use absent tools.
 * Returns the prompt unchanged when no MCP servers are configured or none need auth.
 */
async function appendMcpNeedsAuthNote(
  systemPrompt: RuntimeConfig["systemPrompt"],
  mcpServers: RuntimeConfig["diligent"]["mcpServers"],
): Promise<RuntimeConfig["systemPrompt"]> {
  if (!mcpServers || Object.keys(mcpServers).length === 0) return systemPrompt;
  const statuses = await getMcpManager().listStatus(mcpServers);
  const note = buildMcpNeedsAuthNote(statuses);
  if (!note) return systemPrompt;
  return [...systemPrompt, { tag: "mcp_status", label: "mcp_needs_auth", content: note, cacheControl: "ephemeral" }];
}

interface AgentAssemblyOptions {
  request: CreateAgentArgs;
  runtimeConfig: RuntimeConfig;
  getPaths: () => Promise<DiligentPaths>;
  loadSkills: (cwd: string) => Promise<ActiveSkills>;
  bundledToolProviders?: BundledToolProvider[];
  pluginDiscovery: PluginDiscoveryMode;
  transformTools?: CreateAppServerConfigOptions["transformTools"];
  toolOutputStore?: ToolOutputFileStore;
}

async function buildRuntimeAgentTools(
  args: AgentAssemblyOptions,
  parentSystemPrompt: SystemSection[],
  activeSkills: ActiveSkills,
) {
  const {
    request,
    runtimeConfig,
    getPaths,
    loadSkills,
    bundledToolProviders,
    pluginDiscovery,
    transformTools,
    toolOutputStore: selectedOutputStore,
  } = args;
  const {
    cwd,
    mode,
    effort,
    fastMode,
    model: modelRef,
    approve,
    ask,
    getSessionId,
    existingAgent,
    onChildStop,
    onChildEntryAppended,
    getUserId,
    userId,
  } = request;
  const paths = await getPaths();
  const model = resolveModel(modelRef);
  const sessionId = getSessionId?.();
  const generateText: TextGenerationFn = async (input, options = {}) => {
    options.signal?.throwIfAborted();
    const providerStream = runtimeConfig.streamFunction(
      model,
      {
        systemPrompt: [{ label: "system", content: input.systemPrompt }],
        messages: [{ role: "user", content: input.prompt, timestamp: Date.now() }],
        tools: [],
      },
      {
        signal: options.signal,
        effort: "low",
        maxTokens: options.maxTokens ?? resolveMaxTokens(model),
        sessionId,
      },
    );
    const result = await providerStream.result();
    options.signal?.throwIfAborted();
    return result.message.content
      .filter(
        (block): block is Extract<(typeof result.message.content)[number], { type: "text" }> => block.type === "text",
      )
      .map((block) => block.text)
      .join("\n");
  };
  const codeMode = runtimeConfig.diligent.tools?.codeMode ?? "on";
  const shellProcesses = request.shellProcesses ?? new ShellProcessRegistry();
  const toolsResult = await buildDefaultTools({
    cwd,
    paths,
    collabDeps: {
      parentSystemPrompt,
      mode: mode ?? "default",
      getGoalScope: request.goalHost?.scope,
      model: modelRef,
      shellProcesses,
      effort,
      fastMode,
      agentDefinitions: runtimeConfig.agentDefinitions,
      getParentSessionId: getSessionId,
      approve,
      ask,
      streamFn: runtimeConfig.streamFunction,
      onChildStop,
      userId,
      runObserved: request.runObserved,
      observeModelAttempt: request.observeModelAttempt,
      toolOutputStore: selectedOutputStore,
      onChildEntryAppended,
      getUserId,
      agentLoopHookFactories: bundledToolProviders
        ?.map((provider) => provider.createAgentLoopHooks)
        .filter((factory) => factory !== undefined),
      codeMode,
    },
    toolsConfig: runtimeConfig.diligent.tools,
    skills: { skills: activeSkills.skills, errors: activeSkills.errors, reload: () => loadSkills(cwd) },
    enableCollabTools: true,
    existingRegistry: existingAgent?.registry,
    host: createRuntimeToolHost(approve, ask),
    shellProcesses,
    goalHost: request.goalHost,
    generateImage: (input, options) =>
      runtimeConfig.providerManager.generateImage(model.provider as ProviderName, input, options),
    generateText,
    sessionId,
    bundledToolProviders,
    pluginDiscovery,
    disabledToolNames: runtimeConfig.disabledToolNames,
    provider: model.provider as ProviderName,
    mcpServers: runtimeConfig.diligent.mcpServers,
    mcpToolLoading: runtimeConfig.diligent.mcp?.toolLoading ?? "auto",
    mcpLazyThreshold: runtimeConfig.diligent.mcp?.lazyThreshold,
    mcpMaxOutputTokens: runtimeConfig.diligent.mcp?.maxOutputTokens,
    mcpWarnOutputTokens: runtimeConfig.diligent.mcp?.warnOutputTokens,
    mcpResources: runtimeConfig.diligent.mcp?.resources,
    mcpPrompts: runtimeConfig.diligent.mcp?.prompts,
  });

  const activeMode = (mode ?? "default") as Mode;
  const modeFilteredTools = filterToolsByMode(activeMode, toolsResult.tools);
  let filteredTools = modeFilteredTools;
  if (transformTools) {
    filteredTools = transformTools(modeFilteredTools, {
      cwd,
      mode: activeMode,
      provider: model.provider as ProviderName,
    });
  }
  if (toolsResult.registry) {
    toolsResult.registry.updateDeps({
      parentSystemPrompt,
      mode: activeMode,
      getGoalScope: request.goalHost?.scope,
      shellProcesses,
      model: modelRef,
      effort,
      fastMode,
      agentDefinitions: runtimeConfig.agentDefinitions,
      parentTools: filteredTools,
      getParentSessionId: getSessionId,
      approve,
      ask,
      streamFn: runtimeConfig.streamFunction,
      onChildStop,
      userId,
      runObserved: request.runObserved,
      observeModelAttempt: request.observeModelAttempt,
      codeMode,
      onChildEntryAppended,
      getUserId,
    });
  }
  // `filteredTools` stays the direct list: children inherit it and apply code mode to their own copy.
  const codeModeSession = existingAgent?.codeModeSession ?? new CodeModeSession();
  const tools = applyCodeMode(filteredTools, {
    codeMode,
    session: codeModeSession,
    outputStore: selectedOutputStore ?? toolOutputStore,
  });
  return { tools, registry: toolsResult.registry, codeModeSession, availableTools: filteredTools };
}

async function createRuntimeAgent(args: AgentAssemblyOptions): Promise<RuntimeAgent> {
  const { request, runtimeConfig, getPaths, bundledToolProviders } = args;
  const { cwd, mode, effort, fastMode, model: modelRef } = request;
  const model = resolveModel(modelRef);
  const activeMode = (mode ?? "default") as Mode;
  const activeSkills = await args.loadSkills(cwd);
  const systemPrompt = await withLatestMemory(
    withSkills(runtimeConfig.systemPrompt, activeSkills.skills),
    await getPaths(),
    runtimeConfig.diligent.memory,
  );
  const { tools, registry, codeModeSession, availableTools } = await buildRuntimeAgentTools(
    args,
    systemPrompt,
    activeSkills,
  );
  // Tool assembly syncs MCP auth first; read that same cached status for the prompt note.
  const promptSections = await appendMcpNeedsAuthNote(systemPrompt, runtimeConfig.diligent.mcpServers);
  const llmCompactionFn = runtimeConfig.providerManager.createNativeCompactionForProvider(
    model.provider as ProviderName,
  );
  const loopHookLogger = logger.child({ scope: "runtime.agent.loop-hooks" });
  const { planIntervalTurns, memoryIntervalTurns } = runtimeConfig.reminders;
  const loopHooks: AgentLoopHook[] = [];
  if (request.goalHost) loopHooks.push(createGoalContextHook(request.goalHost));
  if (planIntervalTurns > 0) {
    loopHooks.push(
      createReminderHook({ intervalTurns: planIntervalTurns, policy: createPlanReminder(loopHookLogger) }),
    );
  }
  if (memoryIntervalTurns > 0) {
    loopHooks.push(
      createReminderHook({ intervalTurns: memoryIntervalTurns, policy: createMemoryNudge(loopHookLogger) }),
    );
  }
  loopHooks.push(
    ...createBundledAgentLoopHooks(bundledToolProviders, {
      cwd,
      agentKind: "main",
      model,
      tools,
      sessionId: request.getSessionId?.(),
      logger: loopHookLogger,
    }),
  );
  return new RuntimeAgent(
    model,
    applyModeToPrompt(activeMode, withToolInstructions(promptSections, availableTools)),
    tools,
    {
      effort,
      fastMode,
      llmMsgStreamFn: runtimeConfig.streamFunction,
      observeModelAttempt: request.observeModelAttempt,
      llmCompactionFn,
      localImageLoader: createLocalImageLoader(cwd),
      toolOutputStore: args.toolOutputStore ?? toolOutputStore,
      compaction: {
        enabled: runtimeConfig.compaction.enabled,
        reservePercent: runtimeConfig.compaction.reservePercent,
        timeoutMs: runtimeConfig.compaction.timeoutMs,
      },
      loopHooks,
    },
    registry,
    codeModeSession,
  );
}

export interface CreateAppServerConfigOptions {
  cwd: string;
  runtimeConfig: RuntimeConfig;
  bundledToolProviders?: BundledToolProvider[];
  /** Whether plugin assembly includes globally discovered packages (default `global`). */
  pluginDiscovery?: PluginDiscoveryMode;
  transformTools?: (tools: Tool[], context: { cwd: string; mode: Mode; provider: ProviderName }) => Tool[];
  /** Optional assembly-owned store for full tool outputs; defaults to the production runtime store. */
  toolOutputStore?: ToolOutputFileStore;
  terminalSpawner?: DiligentAppServerConfig["terminalSpawner"];
  overrides?: Partial<
    Pick<
      DiligentAppServerConfig,
      "serverName" | "serverVersion" | "getInitializeResult" | "openBrowser" | "toImageUrl" | "onCurrentThreadChange"
    >
  >;
}

export function createAppServerConfig(opts: CreateAppServerConfigOptions): DiligentAppServerConfig {
  const {
    cwd,
    runtimeConfig,
    bundledToolProviders = [],
    pluginDiscovery = "global",
    transformTools,
    toolOutputStore,
    overrides,
  } = opts;
  const modelInfoList = getModelInfoList();
  const initialEffort = runtimeConfig.effort;
  const experimentDefinitions = runtimeConfig.experimentDefinitions ?? [];
  const experimentManagedSkillNames = new Set(
    experimentDefinitions.flatMap((definition) => [...(definition.skillNames ?? [])]),
  );
  const experimentManagedAgentNames = new Set(
    experimentDefinitions.flatMap((definition) => [...(definition.agentNames ?? [])]),
  );
  for (const entry of runtimeConfig.agentCatalog ?? []) {
    if (entry.required) experimentManagedAgentNames.delete(entry.definition.name);
  }

  // Wire interactive OAuth for remote MCP servers: token state lives under the global
  // diligent dir, and browser login uses the client-provided opener (falls back to default).
  if (runtimeConfig.diligent.mcpServers) {
    getMcpManager().setOAuthDeps({
      storeDir: join(dirname(getGlobalConfigPath()), "mcp-oauth"),
      openBrowser: overrides?.openBrowser ?? defaultOpenBrowser,
    });
  }

  // Only surface models for providers the user has actually connected, so the picker reflects
  // configured providers (and grows as more are connected) rather than the full hardcoded list.
  const modelsForConfiguredProviders = (): typeof modelInfoList => {
    const configured = runtimeConfig.providerManager.getConfiguredProviders() as string[];
    return modelInfoList.filter((m) => configured.includes(m.provider));
  };

  // Lazily resolve paths from the startup cwd — idempotent, cached after first call
  let pathsPromise: ReturnType<typeof ensureDiligentDir> | undefined;
  const getPaths = () => {
    pathsPromise ??= ensureDiligentDir(cwd);
    return pathsPromise;
  };
  const resolveSkillConfig = async (requestCwd: string) => {
    if (requestCwd === cwd) {
      return { config: runtimeConfig.diligent.skills, layers: runtimeConfig.configLayers ?? {} };
    }
    const loaded = await loadDiligentConfig(requestCwd);
    return { config: loaded.config.skills, layers: loaded.layers };
  };
  // Skills are rediscovered per request cwd so threads see skills installed after startup and in their own project.
  const loadSkills = async (requestCwd: string) => {
    const { config, layers } = await resolveSkillConfig(requestCwd);
    const active = await loadActiveSkills({
      cwd: requestCwd,
      config,
      layers,
      disabledSkillNames: runtimeConfig.disabledSkillNames,
    });
    return { config, layers, ...active };
  };
  const assemblyOptions = {
    runtimeConfig,
    getPaths,
    loadSkills,
    bundledToolProviders,
    pluginDiscovery,
    transformTools,
    toolOutputStore,
  };

  const config: DiligentAppServerConfig = {
    cwd,
    pluginDiscovery,
    terminalSpawner: opts.terminalSpawner,
    defaultEffort: initialEffort,
    getInitializeResult: async () => {
      return {
        cwd,
        mode: runtimeConfig.mode,
        effort: initialEffort,
        fastMode: false,
        currentModel: runtimeConfig.model,
        availableModels: modelsForConfiguredProviders(),
      };
    },
    resolvePaths: (requestCwd) => ensureDiligentDir(requestCwd),
    createAgent: (args: CreateAgentArgs): Promise<RuntimeAgent> =>
      createRuntimeAgent({ ...assemblyOptions, request: args }),
    refreshAgentTools: async (agent, request) => {
      const activeSkills = await loadSkills(request.cwd);
      const systemPrompt = withSkills(agent.systemPrompt, activeSkills.skills);
      const { tools, availableTools } = await buildRuntimeAgentTools(
        {
          ...assemblyOptions,
          request: { ...request, existingAgent: agent },
        },
        systemPrompt,
        activeSkills,
      );
      agent.tools = tools;
      agent.systemPrompt = withToolInstructions(systemPrompt, availableTools);
    },
    getGoalsConfig: () => runtimeConfig.diligent.goals,
    streamFunction: runtimeConfig.streamFunction,
    createNativeCompaction: (provider: ProviderName) =>
      runtimeConfig.providerManager.createNativeCompactionForProvider(provider),
    compaction: runtimeConfig.compaction,
    toolConfig: {
      getTools: () => runtimeConfig.diligent.tools,
      setTools: (tools) => {
        runtimeConfig.diligent = {
          ...runtimeConfig.diligent,
          ...(tools ? { tools } : {}),
        };
        if (!tools) {
          delete runtimeConfig.diligent.tools;
        }
      },
    },
    skillConfig: {
      resolve: async (requestCwd) => {
        const { config, layers, discovered } = await loadSkills(requestCwd);
        return {
          cwd: requestCwd,
          config,
          layers,
          discoveredSkills: discovered.filter((skill) => !experimentManagedSkillNames.has(skill.name)),
        };
      },
    },
    experimentConfig: {
      getDefinitions: () => experimentDefinitions,
      getExperiments: () => runtimeConfig.experiments ?? [],
    },
    subagentConfig: {
      resolve: async (requestCwd) => {
        if (requestCwd !== cwd) {
          throw new Error(`Subagent settings are only available for the app-server startup cwd: ${cwd}`);
        }
        return {
          cwd,
          config: runtimeConfig.diligent.agents,
          layers: runtimeConfig.configLayers ?? {},
          catalog: runtimeConfig.agentCatalog,
          experimentManagedAgentNames,
        };
      },
    },
    modelConfig: {
      currentModel: runtimeConfig.model,
      getAvailableModels: () => modelsForConfiguredProviders(),
      onModelChange: (model, threadId) => {
        if (!threadId) {
          runtimeConfig.model = resolveModel(model);
          saveGlobalModel(model).catch((err) => {
            logger.warn("persist_model_failed", {
              message: `[config] Failed to persist model selection: ${err instanceof Error ? err.message : String(err)}`,
              error: err,
              fields: { model },
            });
          });
        }
      },
    },
    providerManager: runtimeConfig.providerManager,
    providerAuthPresenter: runtimeConfig.providerAuthPresenter,
    authStore: runtimeConfig.authStore,
    permissionEngine: runtimeConfig.permissionEngine,
    denialBreakerThreshold: runtimeConfig.diligent.approvals?.denialBreakerThreshold,
    getSkillNames: async (requestCwd) => (await loadSkills(requestCwd)).skills.map((skill) => skill.name),
    hooks: runtimeConfig.diligent.hooks,
    bundledToolProviders,
    mcpServers: runtimeConfig.diligent.mcpServers,
    userId: runtimeConfig.diligent.userId,
    ...overrides,
  };

  // Assigned after `config` exists so it can refresh the frozen snapshots (`mcpServers`,
  // `hooks`) alongside the mutable `runtimeConfig` fields that `createAgent` reads live on every call.
  config.reloadConfig = async (): Promise<ConfigReloadResult> => {
    const paths = await getPaths();
    const fresh = await loadRuntimeConfig(cwd, paths, {
      bundledToolProviders,
      experimentDefinitions,
    });
    runtimeConfig.discoveredSkills = fresh.discoveredSkills;
    runtimeConfig.skills = fresh.skills;
    runtimeConfig.agents = fresh.agents;
    runtimeConfig.discoveredAgents = fresh.discoveredAgents;
    runtimeConfig.agentCatalog = fresh.agentCatalog;
    runtimeConfig.agentDefinitions = fresh.agentDefinitions;
    runtimeConfig.systemPrompt = fresh.systemPrompt;
    runtimeConfig.diligent = fresh.diligent;
    runtimeConfig.sources = fresh.sources;
    runtimeConfig.configLayers = fresh.configLayers;
    runtimeConfig.experiments = fresh.experiments;
    runtimeConfig.disabledToolNames = fresh.disabledToolNames;
    runtimeConfig.disabledSkillNames = fresh.disabledSkillNames;
    runtimeConfig.disabledAgentNames = fresh.disabledAgentNames;
    config.mcpServers = fresh.diligent.mcpServers;
    config.hooks = fresh.diligent.hooks;
    return { skills: fresh.skills.map((skill) => ({ name: skill.name, description: skill.description })) };
  };

  return config;
}
