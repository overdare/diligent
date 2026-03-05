// @summary Tests for loadRuntimeConfig happy-path: model, mode, compaction defaults, and streamFunction
import { expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRuntimeConfig } from "@diligent/core";

function makeTmpEnv(base: string) {
  const knowledge = join(base, ".diligent", "knowledge");
  const sessions = join(base, ".diligent", "sessions");
  const skills = join(base, ".diligent", "skills");
  mkdirSync(knowledge, { recursive: true });
  mkdirSync(sessions, { recursive: true });
  mkdirSync(skills, { recursive: true });
  return {
    root: join(base, ".diligent"),
    sessions,
    knowledge,
    skills,
  };
}

test("loads model from diligent.jsonc and returns required fields", async () => {
  const base = join(tmpdir(), `diligent-web-test-${Date.now()}`);
  mkdirSync(base, { recursive: true });
  const paths = makeTmpEnv(base);

  // Write an explicit config so the test is not affected by global ~/.config/diligent/diligent.jsonc
  await Bun.write(join(base, ".diligent", "diligent.jsonc"), JSON.stringify({ model: "claude-sonnet-4-6" }));

  try {
    const config = await loadRuntimeConfig(base, paths);

    expect(config.model!.id).toBe("claude-sonnet-4-6");
    expect(typeof config.streamFunction).toBe("function");
    expect(Array.isArray(config.systemPrompt)).toBe(true);
    expect(config.systemPrompt.length).toBeGreaterThan(0);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("compaction defaults when not configured", async () => {
  const base = join(tmpdir(), `diligent-web-test-${Date.now()}`);
  mkdirSync(base, { recursive: true });
  const paths = makeTmpEnv(base);

  await Bun.write(join(base, ".diligent", "diligent.jsonc"), JSON.stringify({ model: "claude-sonnet-4-6" }));

  try {
    const config = await loadRuntimeConfig(base, paths);

    expect(config.compaction.enabled).toBe(true);
    expect(config.compaction.reservePercent).toBe(16);
    expect(config.compaction.keepRecentTokens).toBe(20000);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("mode defaults to default when not configured", async () => {
  const base = join(tmpdir(), `diligent-web-test-${Date.now()}`);
  mkdirSync(base, { recursive: true });
  const paths = makeTmpEnv(base);

  await Bun.write(join(base, ".diligent", "diligent.jsonc"), JSON.stringify({ model: "claude-sonnet-4-6" }));

  try {
    const config = await loadRuntimeConfig(base, paths);
    expect(config.mode).toBe("default");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
