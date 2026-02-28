import { describe, expect, mock, test } from "bun:test";
import type { ModeKind, SessionManager, SkillMetadata } from "@diligent/core";
import type { AppConfig } from "../src/config";
import { ProviderManager } from "../src/provider-manager";
import { providerCommand } from "../src/tui/commands/builtin/provider";
import type { CommandRegistry } from "../src/tui/commands/registry";
import type { CommandContext } from "../src/tui/commands/types";
import type { ConfirmDialogOptions } from "../src/tui/components/confirm-dialog";
import type { Component, OverlayHandle, OverlayOptions } from "../src/tui/framework/types";

function createMockContext(pm: ProviderManager): {
  ctx: CommandContext;
  lines: string[];
  errors: string[];
  overlays: Component[];
} {
  const lines: string[] = [];
  const errors: string[] = [];
  const overlays: Component[] = [];

  const ctx: CommandContext = {
    app: {
      confirm: async (_o: ConfirmDialogOptions) => true,
      stop: () => {},
    },
    config: {
      apiKey: "",
      model: { id: "claude-sonnet-4-6", provider: "anthropic", contextWindow: 200_000, maxOutputTokens: 16384 },
      systemPrompt: "",
      streamFunction: (() => {}) as unknown as AppConfig["streamFunction"],
      diligent: {},
      sources: [],
      skills: [],
      mode: "default" as ModeKind,
      providerManager: pm,
    },
    sessionManager: null,
    skills: [],
    registry: {} as CommandRegistry,
    requestRender: () => {},
    displayLines: (l: string[]) => lines.push(...l),
    displayError: (msg: string) => errors.push(msg),
    showOverlay: (c: Component, _o?: OverlayOptions) => {
      overlays.push(c);
      return { hide: () => {}, isHidden: () => false, setHidden: () => {} };
    },
    runAgent: async () => {},
    reload: async () => {},
    currentMode: "default" as ModeKind,
    setMode: () => {},
  };

  return { ctx, lines, errors, overlays };
}

describe("/provider command", () => {
  test("no args shows provider picker overlay", async () => {
    const pm = new ProviderManager({
      provider: { anthropic: { apiKey: "sk-ant-1234567890" } },
    });
    const { ctx, overlays } = createMockContext(pm);

    providerCommand.handler(undefined, ctx);
    await new Promise((r) => setTimeout(r, 10));

    expect(overlays.length).toBeGreaterThanOrEqual(1);
  });

  test("status shows configured providers", async () => {
    const pm = new ProviderManager({
      provider: { anthropic: { apiKey: "sk-ant-1234567890" } },
    });
    const { ctx, lines } = createMockContext(pm);

    await providerCommand.handler("status", ctx);

    const output = lines.join("\n");
    expect(output).toContain("anthropic");
    expect(output).toContain("configured");
    expect(output).toContain("sk-ant-...");
  });

  test("status shows unconfigured providers", async () => {
    const origAnthro = process.env.ANTHROPIC_API_KEY;
    const origOpenai = process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const pm = new ProviderManager({});
      const { ctx, lines } = createMockContext(pm);

      await providerCommand.handler("status", ctx);

      const output = lines.join("\n");
      expect(output).toContain("not configured");
    } finally {
      if (origAnthro) process.env.ANTHROPIC_API_KEY = origAnthro;
      if (origOpenai) process.env.OPENAI_API_KEY = origOpenai;
    }
  });

  test("set with valid provider shows text input overlay", async () => {
    const origKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const pm = new ProviderManager({});
      const { ctx, overlays } = createMockContext(pm);

      // Fire and forget — overlay is async
      providerCommand.handler("set openai", ctx);
      // Give microtask a chance
      await new Promise((r) => setTimeout(r, 10));

      expect(overlays.length).toBeGreaterThanOrEqual(1);
    } finally {
      if (origKey) process.env.OPENAI_API_KEY = origKey;
    }
  });

  test("set without provider shows list picker overlay", async () => {
    const pm = new ProviderManager({});
    const { ctx, overlays } = createMockContext(pm);

    providerCommand.handler("set", ctx);
    await new Promise((r) => setTimeout(r, 10));

    expect(overlays.length).toBeGreaterThanOrEqual(1);
  });

  test("unknown subcommand shows error", async () => {
    const pm = new ProviderManager({});
    const { ctx, errors } = createMockContext(pm);

    await providerCommand.handler("foobar", ctx);

    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("Unknown subcommand");
  });
});
