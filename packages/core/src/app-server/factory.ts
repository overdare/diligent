// @summary Factory that builds a DiligentAppServerConfig from a RuntimeConfig, eliminating Web/CLI duplication
import type { ModeKind } from "../agent/types";
import type { RuntimeConfig } from "../config/runtime";
import { ensureDiligentDir } from "../infrastructure/diligent-dir";
import { getModelInfoList, resolveModel } from "../provider/models";
import { buildDefaultTools } from "../tools/defaults";
import type { DiligentAppServerConfig } from "./server";

export interface CreateAppServerConfigOptions {
  cwd: string;
  runtimeConfig: RuntimeConfig;
  overrides?: Partial<
    Pick<DiligentAppServerConfig, "serverName" | "serverVersion" | "getInitializeResult" | "openBrowser" | "toImageUrl">
  >;
}

export function createAppServerConfig(opts: CreateAppServerConfigOptions): DiligentAppServerConfig {
  const { cwd, runtimeConfig, overrides } = opts;
  const modelInfoList = getModelInfoList();
  const initialEffort = runtimeConfig.effort;

  // Lazily resolve paths from the startup cwd — idempotent, cached after first call
  let pathsPromise: ReturnType<typeof ensureDiligentDir> | undefined;
  const getPaths = () => {
    pathsPromise ??= ensureDiligentDir(cwd);
    return pathsPromise;
  };

  const config: DiligentAppServerConfig = {
    cwd,
    defaultEffort: initialEffort,
    getInitializeResult: async () => ({
      cwd,
      mode: runtimeConfig.mode,
      effort: initialEffort,
      currentModel: runtimeConfig.model?.id,
      availableModels: modelInfoList,
    }),
    resolvePaths: (requestCwd) => ensureDiligentDir(requestCwd),
    buildAgentConfig: async ({
      cwd: requestCwd,
      mode,
      effort,
      modelId,
      signal,
      approve,
      ask,
      getSessionId,
      existingRegistry,
    }) => {
      const resolvedModel = modelId ? resolveModel(modelId) : runtimeConfig.model;
      if (!resolvedModel) {
        throw new Error("No AI provider configured. Please add an API key in the provider settings.");
      }

      const rawPrompt = runtimeConfig.systemPrompt;
      const hasSkillSection = rawPrompt.some((section) => section.label === "skills");
      const hasSkills = runtimeConfig.skills.length > 0;
      const systemPromptWithSkillGuard = hasSkillSection
        ? rawPrompt
        : hasSkills
          ? [
              ...rawPrompt,
              {
                label: "skill_usage_guardrail",
                content: [
                  "Skills must be loaded through the skill tool.",
                  "Do not use read to open SKILL.md directly.",
                  "When the user mentions a skill by name or requests a skill-like workflow, call skill first.",
                ].join("\n"),
              },
            ]
          : rawPrompt;

      const paths = await getPaths();
      const deps = {
        model: resolvedModel,
        effort,
        systemPrompt: systemPromptWithSkillGuard,
        streamFunction: runtimeConfig.streamFunction,
        getParentSessionId: getSessionId,
        ask,
      };
      const resultWithSkills = await buildDefaultTools(
        requestCwd,
        paths,
        deps,
        runtimeConfig.diligent.tools,
        runtimeConfig.skills,
        existingRegistry,
        resolvedModel.provider,
      );

      return {
        model: resolvedModel,
        systemPrompt: systemPromptWithSkillGuard,
        tools: resultWithSkills.tools,
        streamFunction: runtimeConfig.streamFunction,
        mode: mode as ModeKind,
        effort,
        signal,
        approve,
        ask,
        permissionEngine: runtimeConfig.permissionEngine,
        registry: resultWithSkills.registry,
      };
    },
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
    modelConfig: {
      currentModelId: runtimeConfig.model?.id,
      getAvailableModels: () => {
        const configured = runtimeConfig.providerManager.getConfiguredProviders() as string[];
        return modelInfoList.filter((m) => configured.includes(m.provider));
      },
      onModelChange: (modelId, threadId) => {
        if (!threadId) {
          runtimeConfig.model = resolveModel(modelId);
        }
      },
    },
    providerManager: runtimeConfig.providerManager,
    skillNames: runtimeConfig.skills.map((skill) => skill.name),
    ...overrides,
  };

  return config;
}
