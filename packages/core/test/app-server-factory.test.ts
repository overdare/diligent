// @summary Tests for createAppServerConfig factory — validates config assembly and override merging
import { describe, expect, it } from "bun:test";
import { createAppServerConfig } from "../src/app-server/factory";
import type { PermissionEngine } from "../src/approval";
import type { RuntimeConfig } from "../src/config/runtime";
import { getModelInfoList } from "../src/provider/models";
import { ProviderManager } from "../src/provider/provider-manager";
import type { Model } from "../src/provider/types";

function makeRuntimeConfig(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  const providerManager = new ProviderManager({});
  const permissionEngine: PermissionEngine = {
    check: async () => ({ decision: "allow" }),
  };
  const model: Model = {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
  };
  return {
    model,
    mode: "default",
    systemPrompt: [{ label: "base", content: "test" }],
    streamFunction: () => {
      throw new Error("not implemented");
    },
    diligent: {},
    sources: [],
    skills: [],
    compaction: { enabled: true, reservePercent: 16, keepRecentTokens: 20000 },
    permissionEngine,
    providerManager,
    ...overrides,
  };
}

describe("createAppServerConfig", () => {
  it("produces a valid config from a minimal RuntimeConfig", () => {
    const runtimeConfig = makeRuntimeConfig();
    const config = createAppServerConfig({ cwd: "/tmp/test", runtimeConfig });

    expect(config.cwd).toBe("/tmp/test");
    expect(config.resolvePaths).toBeTypeOf("function");
    expect(config.buildAgentConfig).toBeTypeOf("function");
    expect(config.compaction).toEqual(runtimeConfig.compaction);
    expect(config.providerManager).toBe(runtimeConfig.providerManager);
    expect(config.modelConfig).toBeDefined();
    expect(config.modelConfig?.currentModelId).toBe("claude-sonnet-4-6");
  });

  it("merges overrides for toImageUrl and openBrowser", () => {
    const runtimeConfig = makeRuntimeConfig();
    const toImageUrl = (path: string) => `http://localhost/img/${path}`;
    const openBrowser = (url: string) => {
      void url;
    };

    const config = createAppServerConfig({
      cwd: "/tmp/test",
      runtimeConfig,
      overrides: { toImageUrl, openBrowser },
    });

    expect(config.toImageUrl).toBe(toImageUrl);
    expect(config.openBrowser).toBe(openBrowser);
  });

  it("overrides do not clobber core fields", () => {
    const runtimeConfig = makeRuntimeConfig();
    const config = createAppServerConfig({
      cwd: "/tmp/test",
      runtimeConfig,
      overrides: { serverName: "custom" },
    });

    expect(config.serverName).toBe("custom");
    expect(config.buildAgentConfig).toBeTypeOf("function");
    expect(config.compaction).toBeDefined();
  });

  it("modelConfig.onModelChange updates runtimeConfig.model", () => {
    const runtimeConfig = makeRuntimeConfig();
    const config = createAppServerConfig({ cwd: "/tmp/test", runtimeConfig });

    config.modelConfig?.onModelChange("claude-haiku-4-5-20251001");
    expect(runtimeConfig.model?.id).toBe("claude-haiku-4-5-20251001");
  });

  it("toolConfig.setTools updates runtimeConfig.diligent.tools", () => {
    const runtimeConfig = makeRuntimeConfig();
    const config = createAppServerConfig({ cwd: "/tmp/test", runtimeConfig });

    config.toolConfig?.setTools({
      builtin: { bash: false },
      conflictPolicy: "plugin_wins",
    });
    expect(config.toolConfig?.getTools()).toEqual({
      builtin: { bash: false },
      conflictPolicy: "plugin_wins",
    });
    expect(runtimeConfig.diligent.tools).toEqual({
      builtin: { bash: false },
      conflictPolicy: "plugin_wins",
    });

    config.toolConfig?.setTools(undefined);
    expect(config.toolConfig?.getTools()).toBeUndefined();
    expect(runtimeConfig.diligent.tools).toBeUndefined();
  });

  it("buildAgentConfig throws when model is undefined", async () => {
    const runtimeConfig = makeRuntimeConfig({ model: undefined });
    const config = createAppServerConfig({ cwd: "/tmp/test", runtimeConfig });

    await expect(
      config.buildAgentConfig({
        cwd: "/tmp/test",
        mode: "default",
        effort: "medium",
        signal: new AbortController().signal,
        approve: async (r) => ({ approved: true, toolCallId: r.toolCallId }),
        ask: async () => ({ requestId: "", response: "" }),
      }),
    ).rejects.toThrow("No AI provider configured");
  });
});

describe("getModelInfoList", () => {
  it("returns an entry for each known model with required fields", () => {
    const list = getModelInfoList();
    expect(list.length).toBeGreaterThan(0);
    for (const m of list) {
      expect(m.id).toBeTypeOf("string");
      expect(m.provider).toBeTypeOf("string");
      expect(m.contextWindow).toBeGreaterThan(0);
      expect(m.maxOutputTokens).toBeGreaterThan(0);
    }
  });
});
