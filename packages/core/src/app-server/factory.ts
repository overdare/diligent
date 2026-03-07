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

  // Lazily resolve paths from the startup cwd — idempotent, cached after first call
  let pathsPromise: ReturnType<typeof ensureDiligentDir> | undefined;
  const getPaths = () => {
    pathsPromise ??= ensureDiligentDir(cwd);
    return pathsPromise;
  };

  const config: DiligentAppServerConfig = {
    cwd,
    resolvePaths: (requestCwd) => ensureDiligentDir(requestCwd),
    buildAgentConfig: async ({ cwd: requestCwd, mode, effort, signal, approve, ask, getSessionId }) => {
      if (!runtimeConfig.model) {
        throw new Error("No AI provider configured. Please add an API key in the provider settings.");
      }

      const paths = await getPaths();
      const deps = {
        model: runtimeConfig.model,
        systemPrompt: runtimeConfig.systemPrompt,
        streamFunction: runtimeConfig.streamFunction,
        getParentSessionId: getSessionId,
        ask,
      };
      const result = await buildDefaultTools(requestCwd, paths, deps, runtimeConfig.diligent.tools);

      return {
        model: runtimeConfig.model,
        systemPrompt: runtimeConfig.systemPrompt,
        tools: result.tools,
        streamFunction: runtimeConfig.streamFunction,
        mode: mode as ModeKind,
        effort,
        signal,
        approve,
        ask,
        permissionEngine: runtimeConfig.permissionEngine,
        registry: result.registry,
      };
    },
    compaction: runtimeConfig.compaction,
    modelConfig: {
      currentModelId: runtimeConfig.model?.id,
      getAvailableModels: () => {
        const configured = runtimeConfig.providerManager.getConfiguredProviders() as string[];
        return modelInfoList.filter((m) => configured.includes(m.provider));
      },
      onModelChange: (modelId) => {
        runtimeConfig.model = resolveModel(modelId);
      },
    },
    providerManager: runtimeConfig.providerManager,
    ...overrides,
  };

  return config;
}
