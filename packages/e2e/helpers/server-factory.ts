// @summary Test server factory creating DiligentAppServer with fake stream and optional tools

import type { RuntimeConfig, StreamFunction, Tool } from "@diligent/runtime";
import {
  createAppServerConfig,
  createYoloPermissionEngine,
  DiligentAppServer,
  ensureDiligentDir,
  ProviderManager,
  RuntimeAgent,
} from "@diligent/runtime";
import { createSimpleStream } from "./fake-stream";

export function createTestServer(opts: {
  cwd: string;
  streamFunction?: StreamFunction;
  tools?: Tool[];
  runtimeToolsConfig?: RuntimeConfig["diligent"]["tools"];
}): DiligentAppServer {
  const streamFn = opts.streamFunction ?? createSimpleStream("ok");

  if (!opts.runtimeToolsConfig) {
    return new DiligentAppServer({
      cwd: opts.cwd,
      resolvePaths: async (cwd) => ensureDiligentDir(cwd),
      createAgent: () =>
        new RuntimeAgent(
          { id: "fake", provider: "fake", contextWindow: 8192, maxOutputTokens: 4096, supportsThinking: false },
          [],
          opts.tools ?? [],
          { effort: "medium", llmMsgStreamFn: streamFn },
        ),
    });
  }

  const providerManager = new ProviderManager({});
  const runtimeConfig: RuntimeConfig = {
    model: { id: "fake", provider: "fake", contextWindow: 8192, maxOutputTokens: 4096, supportsThinking: false },
    effort: "medium",
    mode: "default",
    systemPrompt: [],
    streamFunction: streamFn,
    diligent: { tools: opts.runtimeToolsConfig },
    sources: [],
    skills: [],
    compaction: {
      enabled: true,
      reservePercent: 16,
      keepRecentTokens: 20_000,
    },
    permissionEngine: createYoloPermissionEngine(),
    providerManager,
  };

  const base = createAppServerConfig({ cwd: opts.cwd, runtimeConfig });

  return new DiligentAppServer({
    ...base,
    resolvePaths: async (cwd) => ensureDiligentDir(cwd),
  });
}
