// @summary Tests for config loading and merging behavior
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDiligentConfig, mergeConfig } from "../src/config/loader";
import type { DiligentConfig } from "../src/config/schema";

const TEST_ROOT = join(tmpdir(), `diligent-config-test-${Date.now()}`);
let origHome: string | undefined;

/** Project config lives inside .diligent/ alongside sessions, knowledge, skills */
const projectConfigPath = (root: string) => join(root, ".diligent", "config.jsonc");

beforeEach(() => {
  origHome = process.env.HOME;
  process.env.HOME = TEST_ROOT;
});

afterEach(async () => {
  if (origHome !== undefined) process.env.HOME = origHome;
  else delete process.env.HOME;
  try {
    await rm(TEST_ROOT, { recursive: true, force: true });
  } catch {}
});

describe("mergeConfig", () => {
  it("override replaces scalar values", () => {
    const base: DiligentConfig = { model: "a" };
    const override: DiligentConfig = { model: "b" };
    const result = mergeConfig(base, override);
    expect(result.model).toBe("b");
  });

  it("deep merges objects", () => {
    const base: DiligentConfig = { provider: { anthropic: { apiKey: "old" } } };
    const override: DiligentConfig = { provider: { openai: { apiKey: "new" } } };
    const result = mergeConfig(base, override);
    expect(result.provider?.anthropic?.apiKey).toBe("old");
    expect(result.provider?.openai?.apiKey).toBe("new");
  });

  it("concatenates instructions with deduplication (D034)", () => {
    const base: DiligentConfig = { instructions: ["Use Bun", "Run tests"] };
    const override: DiligentConfig = { instructions: ["Run tests", "Use strict"] };
    const result = mergeConfig(base, override);
    expect(result.instructions).toEqual(["Use Bun", "Run tests", "Use strict"]);
  });

  it("undefined values in override are ignored", () => {
    const base: DiligentConfig = { model: "keep" };
    const override: DiligentConfig = {};
    const result = mergeConfig(base, override);
    expect(result.model).toBe("keep");
  });
});

describe("loadDiligentConfig", () => {
  it("returns default config when no files exist", async () => {
    await mkdir(TEST_ROOT, { recursive: true });
    const { config, sources } = await loadDiligentConfig(TEST_ROOT);
    expect(config.model).toBe("claude-sonnet-4-6");
    expect(sources).toEqual([]);
  });

  it("loads project config from .diligent/config.jsonc", async () => {
    const configFile = projectConfigPath(TEST_ROOT);
    await mkdir(join(TEST_ROOT, ".diligent"), { recursive: true });
    await Bun.write(
      configFile,
      `{
        // Project config with JSONC comments
        "model": "claude-opus-4-20250514",
        "maxTurns": 50
      }`,
    );

    const { config, sources } = await loadDiligentConfig(TEST_ROOT);
    expect(config.model).toBe("claude-opus-4-20250514");
    expect(config.maxTurns).toBe(50);
    expect(config.tools).toBeUndefined();
    expect(sources).toHaveLength(1);
  });

  it("uses tool settings from global config only", async () => {
    const globalConfigFile = join(TEST_ROOT, ".diligent", "config.jsonc");
    const projectConfigFile = projectConfigPath(TEST_ROOT);
    await mkdir(join(TEST_ROOT, ".diligent"), { recursive: true });
    await mkdir(join(TEST_ROOT, ".diligent"), { recursive: true });

    await Bun.write(
      globalConfigFile,
      JSON.stringify({
        tools: {
          builtin: { bash: false },
          plugins: [{ package: "@acme/global-tools", tools: { global_tool: false } }],
        },
      }),
    );
    await Bun.write(
      projectConfigFile,
      JSON.stringify({
        tools: {
          builtin: { read: false },
          plugins: [{ package: "@acme/project-tools", tools: { project_tool: false } }],
        },
      }),
    );

    const { config } = await loadDiligentConfig(TEST_ROOT);
    expect(config.tools).toEqual({
      builtin: { bash: false },
      plugins: [{ package: "@acme/global-tools", enabled: true, tools: { global_tool: false } }],
    });
  });

  it("template substitution replaces {env:VAR}", async () => {
    await mkdir(join(TEST_ROOT, ".diligent"), { recursive: true });
    await Bun.write(projectConfigPath(TEST_ROOT), `{ "provider": { "anthropic": { "apiKey": "{env:MY_KEY}" } } }`);
    process.env.MY_KEY = "resolved-key";

    const { config } = await loadDiligentConfig(TEST_ROOT);
    expect(config.provider?.anthropic?.apiKey).toBe("resolved-key");

    delete process.env.MY_KEY;
  });

  it("template substitution with missing env var yields empty string", async () => {
    await mkdir(join(TEST_ROOT, ".diligent"), { recursive: true });
    await Bun.write(projectConfigPath(TEST_ROOT), `{ "systemPrompt": "prefix-{env:MISSING}-suffix" }`);

    const { config } = await loadDiligentConfig(TEST_ROOT);
    expect(config.systemPrompt).toBe("prefix--suffix");
  });

  it("invalid config file warns and is skipped", async () => {
    await mkdir(join(TEST_ROOT, ".diligent"), { recursive: true });
    await Bun.write(projectConfigPath(TEST_ROOT), `{ "unknownKey": true }`);

    const warnSpy = [] as string[];
    const origWarn = console.warn;
    console.warn = (msg: string) => warnSpy.push(msg);
    try {
      const { config, sources } = await loadDiligentConfig(TEST_ROOT);
      expect(sources).toEqual([]); // file was skipped
      expect(config.model).toBe("claude-sonnet-4-6"); // defaults
      expect(warnSpy.length).toBeGreaterThan(0);
    } finally {
      console.warn = origWarn;
    }
  });
});
