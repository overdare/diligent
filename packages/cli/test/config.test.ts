// @summary Tests for config loading and file operations
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";

const TEST_ROOT = join(tmpdir(), `diligent-cli-config-test-${Date.now()}`);
let origHome: string | undefined;

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

describe("loadConfig", () => {
  test("loads without API key (deferred to call time)", async () => {
    const dir = join(TEST_ROOT, "no-key");
    await mkdir(dir, { recursive: true });

    const config = await loadConfig(dir);
    expect(config.providerManager.hasKeyFor("anthropic")).toBe(false);
    expect(config.apiKey).toBe("");
  });

  test("uses default model when not configured", async () => {
    const dir = join(TEST_ROOT, "defaults");
    await mkdir(dir, { recursive: true });

    const config = await loadConfig(dir);
    expect(config.model.id).toBe("claude-sonnet-4-6");
    expect(config.model.provider).toBe("anthropic");
  });

  test("loads config from diligent.jsonc", async () => {
    const dir = join(TEST_ROOT, "jsonc");
    await mkdir(dir, { recursive: true });
    await Bun.write(
      join(dir, "diligent.jsonc"),
      `{
        // Project config
        "model": "claude-haiku-3-20250307",
        "maxTurns": 10,
        "provider": { "anthropic": { "apiKey": "sk-test" } }
      }`,
    );

    const config = await loadConfig(dir);
    expect(config.model.id).toBe("claude-haiku-3-20250307");
    expect(config.diligent.maxTurns).toBe(10);
    expect(config.sources.length).toBeGreaterThan(0);
  });

  test("injects AGENTS.md into system prompt", async () => {
    const dir = join(TEST_ROOT, "agents-md");
    await mkdir(dir, { recursive: true });
    await mkdir(join(dir, ".git")); // Stop findUp here
    await Bun.write(join(dir, "AGENTS.md"), "# Rules\nAlways use Bun.");

    const config = await loadConfig(dir);
    expect(config.systemPrompt).toContain("Always use Bun.");
  });

  test("system prompt includes cwd and platform", async () => {
    const dir = join(TEST_ROOT, "sys-prompt");
    await mkdir(dir, { recursive: true });

    const config = await loadConfig(dir);
    expect(config.systemPrompt).toContain(dir);
    expect(config.systemPrompt).toContain(process.platform);
  });
});
