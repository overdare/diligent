// @summary Tests for createAppServerConfig factory — validates config assembly and override merging
import { describe, expect, it } from "bun:test";
import { getModelInfoList } from "@diligent/core/llm/models";
import { ProviderManager } from "@diligent/core/llm/provider-manager";
import type { Model } from "@diligent/core/llm/types";
import { createAppServerConfig } from "@diligent/runtime/app-server";
import type { PermissionEngine } from "../../src/approval";
import type { RuntimeConfig } from "../../src/config/runtime";

function makeRuntimeConfig(overrides?: Partial<RuntimeConfig>): RuntimeConfig {
  const providerManager = new ProviderManager({});
  const permissionEngine: PermissionEngine = {
    evaluate: () => "allow",
    remember: () => {},
  };
  const model: Model = {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsThinking: false,
  };
  return {
    model,
    mode: "default",
    effort: "medium",
    systemPrompt: [{ label: "base", content: "test" }],
    streamFunction: () => {
      throw new Error("not implemented");
    },
    diligent: {},
    sources: [],
    skills: [],
    compaction: {
      enabled: true,
      reservePercent: 16,
      keepRecentTokens: 20000,
    },
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
    expect(config.createAgent).toBeTypeOf("function");
    expect(config.compaction).toEqual(runtimeConfig.compaction);
    expect(config.providerManager).toBe(runtimeConfig.providerManager);
    expect(config.permissionEngine).toBe(runtimeConfig.permissionEngine);
    expect(config.modelConfig).toBeDefined();
    expect(config.modelConfig?.currentModelId).toBe("claude-sonnet-4-6");
    expect(config.defaultEffort).toBe("medium");
    expect(config.skillNames).toEqual([]);
  });

  it("uses runtimeConfig.effort as defaultEffort", () => {
    const runtimeConfig = makeRuntimeConfig({ effort: "high" });
    const config = createAppServerConfig({ cwd: "/tmp/test", runtimeConfig });
    expect(config.defaultEffort).toBe("high");
  });

  it("passes skill names for slash disambiguation", () => {
    const runtimeConfig = makeRuntimeConfig({
      skills: [
        {
          name: "tidy-plan",
          description: "desc",
          path: "/tmp/skills/tidy-plan/SKILL.md",
          baseDir: "/tmp/skills/tidy-plan",
          source: "project",
          disableModelInvocation: false,
        },
      ],
    });
    const config = createAppServerConfig({ cwd: "/tmp/test", runtimeConfig });
    expect(config.skillNames).toEqual(["tidy-plan"]);
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
    expect(config.createAgent).toBeTypeOf("function");
    expect(config.compaction).toBeDefined();
  });

  it("modelConfig.onModelChange updates runtimeConfig.model", () => {
    const runtimeConfig = makeRuntimeConfig();
    const config = createAppServerConfig({ cwd: "/tmp/test", runtimeConfig });

    config.modelConfig?.onModelChange("claude-haiku-4-5");
    expect(runtimeConfig.model?.id).toBe("claude-haiku-4-5");
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
