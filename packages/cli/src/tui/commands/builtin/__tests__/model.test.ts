// @summary Tests for model command picker filtering behavior based on provider authentication
import { describe, expect, it, mock } from "bun:test";
import { resolveModel } from "@diligent/runtime";
import type { AppConfig } from "../../../../config";
import type { ListPickerItem } from "../../../components/list-picker";
import type { CommandContext } from "../../types";
import { modelCommand } from "../model";

function makeConfig(modelId: string, providerManager: AppConfig["providerManager"]): AppConfig {
  return {
    apiKey: "",
    model: resolveModel(modelId),
    systemPrompt: [],
    streamFunction: (() => {
      throw new Error("not used");
    }) as AppConfig["streamFunction"],
    diligent: {},
    sources: [],
    skills: [],
    mode: "default",
    compaction: {
      enabled: true,
      reservePercent: 10,
      keepRecentTokens: 4000,
    },
    providerManager,
  } as AppConfig;
}

function makeContext(config: AppConfig, overrides?: Partial<CommandContext>): CommandContext {
  return {
    app: {
      confirm: async () => true,
      pick: async () => null,
      prompt: async () => null,
      stop: () => {},
      getRpcClient: () => null,
    },
    config,
    threadId: null,
    skills: [],
    registry: {} as CommandContext["registry"],
    requestRender: () => {},
    displayLines: () => {},
    displayError: () => {},
    runAgent: async () => {},
    reload: async () => {},
    currentMode: "default",
    setMode: () => {},
    currentEffort: "medium",
    setEffort: async () => {},
    clearChatHistory: () => {},
    clearScreenAndResetRenderer: () => {},
    startNewThread: async () => "thread-1",
    resumeThread: async () => "thread-1",
    deleteThread: async () => true,
    listThreads: async () => [],
    readThread: async () => null,
    onModelChanged: () => {},
    onEffortChanged: () => {},
    ...overrides,
  } as CommandContext;
}

describe("modelCommand picker", () => {
  it("shows only models for authenticated providers", async () => {
    let capturedItems: ListPickerItem[] = [];

    const providerManager = {
      hasKeyFor: mock((provider: string) => provider === "openai"),
    };

    const config = makeConfig("gpt-4o", providerManager as unknown as AppConfig["providerManager"]);

    const ctx = makeContext(config, {
      app: {
        confirm: async () => true,
        pick: async (options) => {
          capturedItems = options.items;
          return null;
        },
        prompt: async () => null,
        stop: () => {},
        getRpcClient: () => null,
      },
    });

    await modelCommand.handler(undefined, ctx);

    expect(capturedItems.length).toBeGreaterThan(0);
    const modelItems = capturedItems.filter((item) => !item.header);
    expect(modelItems.length).toBeGreaterThan(0);
    expect(modelItems.every((item) => resolveModel(item.value).provider === "openai")).toBe(true);
    expect(capturedItems.some((item) => item.header && item.label.includes("openai"))).toBe(true);
    expect(capturedItems.some((item) => item.header && item.label.includes("anthropic"))).toBe(false);
    expect(capturedItems.some((item) => item.header && item.label.includes("gemini"))).toBe(false);
  });

  it("falls back to current provider models when no provider is authenticated", async () => {
    let capturedItems: ListPickerItem[] = [];

    const providerManager = {
      hasKeyFor: mock((_provider: string) => false),
    };

    const config = makeConfig("claude-sonnet-4-6", providerManager as unknown as AppConfig["providerManager"]);

    const ctx = makeContext(config, {
      app: {
        confirm: async () => true,
        pick: async (options) => {
          capturedItems = options.items;
          return null;
        },
        prompt: async () => null,
        stop: () => {},
        getRpcClient: () => null,
      },
    });

    await modelCommand.handler(undefined, ctx);

    expect(capturedItems.length).toBeGreaterThan(0);
    const modelItems = capturedItems.filter((item) => !item.header);
    expect(modelItems.length).toBeGreaterThan(0);
    expect(modelItems.every((item) => resolveModel(item.value).provider === "anthropic")).toBe(true);
    expect(capturedItems.some((item) => item.header && item.label.includes("anthropic"))).toBe(true);
    expect(capturedItems.some((item) => item.header && item.label.includes("openai"))).toBe(false);
  });
});
