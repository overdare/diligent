// @summary Tests for provider command parsing and execution

import { describe, expect, test } from "bun:test";
import type { Mode } from "@diligent/protocol";
import { formatModelRef } from "@diligent/runtime";
import type { AppConfig } from "../../../../src/config";
import { ProviderManager } from "../../../../src/provider-manager";
import { providerCommand } from "../../../../src/tui/commands/builtin/provider";
import type { CommandRegistry } from "../../../../src/tui/commands/registry";
import type { CommandContext } from "../../../../src/tui/commands/types";
import type { ConfirmDialogOptions } from "../../../../src/tui/components/confirm-dialog";

const TEST_ANTHROPIC_MODEL_ID = "claude-sonnet-5";

function createMockContext(pm: ProviderManager): {
  ctx: CommandContext;
  lines: string[];
  errors: string[];
  picks: Array<{ title: string }>;
  prompts: Array<{ title: string }>;
} {
  const lines: string[] = [];
  const errors: string[] = [];
  const picks: Array<{ title: string }> = [];
  const prompts: Array<{ title: string }> = [];

  const ctx: CommandContext = {
    app: {
      confirm: async (_o: ConfirmDialogOptions) => true,
      pick: async (options) => {
        picks.push({ title: options.title });
        return null;
      },
      prompt: async (options) => {
        prompts.push({ title: options.title });
        return null;
      },
      stop: () => {},
    },
    config: {
      apiKey: "",
      model: {
        id: TEST_ANTHROPIC_MODEL_ID,
        provider: "anthropic",
        contextWindow: 1_000_000,
        maxOutputTokens: 64_000,
      },
      systemPrompt: [],
      streamFunction: (() => {}) as unknown as AppConfig["streamFunction"],
      diligent: {},
      sources: [],
      skills: [],
      mode: "default" as Mode,
      providerManager: pm,
    },
    sessionManager: null,
    skills: [],
    registry: {} as CommandRegistry,
    requestRender: () => {},
    displayLines: (l: string[]) => lines.push(...l),
    displayError: (msg: string) => errors.push(msg),
    runAgent: async () => {},
    reload: async () => {},
    currentMode: "default" as Mode,
    setMode: () => {},
    currentEffort: "medium",
    setEffort: async () => {},
    currentFastMode: false,
    setFastMode: async () => {},
    setModel: async () => {},
    clearChatHistory: () => {},
    clearScreenAndResetRenderer: () => {},
    startNewThread: async () => "thread-1",
    resumeThread: async () => "thread-1",
    deleteThread: async () => true,
    listThreads: async () => [],
    loadOlderHistory: async () => {},
    readThread: async () => null,
    onModelChanged: () => {},
    onEffortChanged: () => {},
  };

  return { ctx, lines, errors, picks, prompts };
}

describe("/provider command", () => {
  test("no args opens inline provider picker", async () => {
    const pm = new ProviderManager({});
    pm.setApiKey("anthropic", "sk-ant-1234567890");
    const { ctx, picks } = createMockContext(pm);

    await providerCommand.handler(undefined, ctx);

    expect(picks).toEqual([{ title: "Provider" }]);
  });

  test("status shows configured providers", async () => {
    const pm = new ProviderManager({});
    pm.setApiKey("anthropic", "sk-ant-1234567890");
    const { ctx, lines } = createMockContext(pm);

    await providerCommand.handler("status", ctx);

    const output = lines.join("\n");
    expect(output).toContain("Anthropic");
    expect(output).toContain("configured");
    expect(output).toContain("sk-ant-...");
  });

  test("status shows unconfigured providers", async () => {
    const pm = new ProviderManager({});
    const { ctx, lines } = createMockContext(pm);

    await providerCommand.handler("status", ctx);

    const output = lines.join("\n");
    expect(output).toContain("not configured");
  });

  test("set with valid provider opens inline prompt", async () => {
    const pm = new ProviderManager({});
    const { ctx, prompts } = createMockContext(pm);

    await providerCommand.handler("set openai", ctx);

    expect(prompts).toEqual([{ title: "OpenAI API Key" }]);
  });

  test("set zai-coding-plan opens inline prompt", async () => {
    const pm = new ProviderManager({});
    const { ctx, prompts } = createMockContext(pm);

    await providerCommand.handler("set zai-coding-plan", ctx);

    expect(prompts).toEqual([{ title: "z.ai Coding Plan API Key" }]);
  });

  test("set without provider opens inline provider picker", async () => {
    const pm = new ProviderManager({});
    const { ctx, picks } = createMockContext(pm);

    await providerCommand.handler("set", ctx);

    expect(picks).toEqual([{ title: "Select Provider" }]);
  });

  test("unknown subcommand shows error", async () => {
    const pm = new ProviderManager({});
    const { ctx, errors } = createMockContext(pm);

    await providerCommand.handler("foobar", ctx);

    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("Unknown subcommand");
  });
});

describe("/provider picker flows", () => {
  test("labels the active provider before checking keys, then configured, then no key", async () => {
    const pm = new ProviderManager({});
    pm.setApiKey("openai", "sk-openai-1234567890");
    const { ctx } = createMockContext(pm);
    let offered: Array<{ label: string; description?: string; value: string }> = [];
    ctx.app.pick = async (options) => {
      offered = options.items;
      return null;
    };

    await providerCommand.handler(undefined, ctx);

    const byValue = new Map(offered.map((item) => [item.value, item]));
    expect(byValue.get("anthropic")).toEqual({ label: "Anthropic", description: "active", value: "anthropic" });
    expect(byValue.get("openai")).toEqual({ label: "OpenAI", description: "configured", value: "openai" });
    expect(byValue.get("gemini")).toEqual({ label: "Gemini", description: "no key", value: "gemini" });
  });

  test("selecting the connected active provider offers reconnect actions titled with its name", async () => {
    const pm = new ProviderManager({});
    pm.setApiKey("anthropic", "sk-ant-1234567890");
    const { ctx, lines, errors, prompts } = createMockContext(pm);
    const titles: string[] = [];
    let actionItems: Array<{ description?: string; value: string }> = [];
    ctx.app.pick = async (options) => {
      titles.push(options.title);
      if (options.title === "Provider") return "anthropic";
      actionItems = options.items;
      return "cancel";
    };

    await providerCommand.handler(undefined, ctx);

    expect(titles).toEqual(["Provider", "Anthropic is already connected"]);
    expect(actionItems.map((item) => item.description)).toEqual([
      "Replace saved API key",
      "Remove saved API key",
      "Keep current authentication",
    ]);
    expect(prompts).toEqual([]);
    expect(lines).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("reconnect stores the entered API key and reports it by display name", async () => {
    const pm = new ProviderManager({});
    pm.setApiKey("anthropic", "sk-ant-1234567890");
    const { ctx, lines } = createMockContext(pm);
    const confirmMessages: string[] = [];
    let promptMessage = "";
    ctx.app.pick = async (options) => {
      if (options.title === "Provider") return "anthropic";
      return "reconnect";
    };
    ctx.app.prompt = async (options) => {
      promptMessage = options.message ?? "";
      return "sk-ant-replacement-key";
    };
    ctx.app.confirm = async (options) => {
      confirmMessages.push(options.message);
      return false;
    };

    await providerCommand.handler(undefined, ctx);

    expect(promptMessage).toStartWith("Enter your Anthropic API key (");
    expect(pm.getApiKey("anthropic")).toBe("sk-ant-replacement-key");
    expect(lines.join("\n")).toContain("API key set for Anthropic.");
    expect(confirmMessages).toEqual(["Save Anthropic key to ~/.diligent/auth.jsonc?"]);
  });

  test("disconnect failure reports Error message with provider display name", async () => {
    const pm = new ProviderManager({});
    pm.setApiKey("anthropic", "sk-ant-1234567890");
    const { ctx, lines, errors } = createMockContext(pm);
    const confirmMessages: string[] = [];
    ctx.app.pick = async (options) => {
      if (options.title === "Provider") return "anthropic";
      return "disconnect";
    };
    ctx.app.confirm = async (options) => {
      confirmMessages.push(options.message);
      return true;
    };
    ctx.app.getRpcClient = () =>
      ({
        request: async () => {
          throw new Error("server down");
        },
      }) as never;

    await providerCommand.handler(undefined, ctx);

    expect(confirmMessages).toEqual(["Remove saved API key for Anthropic?"]);
    expect(errors).toEqual(["Failed to disconnect Anthropic: server down"]);
    expect(lines).toEqual([]);
    expect(pm.hasKeyFor("anthropic")).toBe(true);
  });

  test("disconnect failure stringifies non-Error rejections", async () => {
    const pm = new ProviderManager({});
    pm.setApiKey("anthropic", "sk-ant-1234567890");
    const { ctx, errors } = createMockContext(pm);
    ctx.app.pick = async (options) => {
      if (options.title === "Provider") return "anthropic";
      return "disconnect";
    };
    ctx.app.getRpcClient = () =>
      ({
        request: async () => {
          throw "plain failure";
        },
      }) as never;

    await providerCommand.handler(undefined, ctx);

    expect(errors).toEqual(["Failed to disconnect Anthropic: plain failure"]);
  });

  test("switching to a configured provider sets its default model and reports it", async () => {
    const pm = new ProviderManager({});
    pm.setApiKey("anthropic", "sk-ant-1234567890");
    pm.setApiKey("openai", "sk-openai-1234567890");
    const { ctx, lines, errors } = createMockContext(pm);
    const setModels: unknown[] = [];
    ctx.setModel = async (model) => {
      setModels.push(model);
    };
    ctx.app.pick = async () => "openai";

    await providerCommand.handler(undefined, ctx);

    expect(errors).toEqual([]);
    expect(ctx.config.model.provider).toBe("openai");
    expect(setModels).toEqual([ctx.config.model]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Provider: ");
    expect(lines[0]).toContain("OpenAI");
    expect(lines[0]).toContain(`Model: \x1b[1m${formatModelRef(ctx.config.model)}`);
  });

  test("switching to an unconfigured provider is cancelled when no key is entered", async () => {
    const pm = new ProviderManager({});
    pm.setApiKey("anthropic", "sk-ant-1234567890");
    const { ctx, lines, errors, prompts } = createMockContext(pm);
    ctx.app.pick = async () => "gemini";

    await providerCommand.handler(undefined, ctx);

    expect(prompts).toEqual([{ title: "Gemini API Key" }]);
    expect(errors).toEqual(["Provider switch cancelled — no authentication configured."]);
    expect(lines).toEqual([]);
    expect(ctx.config.model.provider).toBe("anthropic");
  });
});
