// @summary Tests for runtime config agent loading and prompt rendering
import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeConfig } from "../../src/config/runtime";
import { loadRuntimeConfig } from "../../src/config/runtime";
import type { DiligentPaths } from "../../src/infrastructure";

let tmpRoot = "";

function makePaths(base: string): DiligentPaths {
  return {
    root: join(base, ".diligent"),
    sessions: join(base, ".diligent", "sessions"),
    knowledge: join(base, ".diligent", "knowledge"),
    skills: join(base, ".diligent", "skills"),
    images: join(base, ".diligent", "images"),
  };
}

afterEach(async () => {
  if (tmpRoot) {
    await rm(tmpRoot, { recursive: true, force: true });
    tmpRoot = "";
  }
});

describe("loadRuntimeConfig", () => {
  it("loads discovered agents and adds an agents section to the system prompt", async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "diligent-runtime-config-"));
    const paths = makePaths(tmpRoot);
    const isolatedHome = join(tmpRoot, ".isolated-home");
    await mkdir(paths.sessions, { recursive: true });
    await mkdir(paths.knowledge, { recursive: true });
    await mkdir(paths.skills, { recursive: true });
    await mkdir(paths.images, { recursive: true });
    await mkdir(join(isolatedHome, ".diligent"), { recursive: true });
    const agentDir = join(tmpRoot, ".diligent", "agents", "code-reviewer");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "AGENT.md"),
      [
        "---",
        "name: code-reviewer",
        "description: Reviews code carefully",
        "tools: read, glob",
        "model_class: general",
        "---",
        "You are a code reviewer.",
      ].join("\n"),
    );
    await writeFile(join(tmpRoot, ".diligent", "config.jsonc"), JSON.stringify({ model: "claude-sonnet-4-6" }));

    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = isolatedHome;
    process.env.USERPROFILE = isolatedHome;
    let config: RuntimeConfig;
    try {
      config = await loadRuntimeConfig(tmpRoot, paths);
    } finally {
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
    }

    expect(config.agents).toHaveLength(1);
    expect(config.agents[0]?.name).toBe("code-reviewer");
    expect(config.agentDefinitions.some((agent) => agent.name === "general" && agent.source === "builtin")).toBe(true);
    expect(config.agentDefinitions.some((agent) => agent.name === "code-reviewer" && agent.source === "user")).toBe(
      true,
    );
    expect(
      config.systemPrompt.some((section) => section.label === "agents" && section.content.includes("code-reviewer")),
    ).toBe(true);
  });

  it("generates and persists a fallback userId when config userId is unset", async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "diligent-runtime-userid-"));
    const paths = makePaths(tmpRoot);
    const isolatedHome = join(tmpRoot, ".isolated-home");
    await mkdir(paths.sessions, { recursive: true });
    await mkdir(paths.knowledge, { recursive: true });
    await mkdir(paths.skills, { recursive: true });
    await mkdir(paths.images, { recursive: true });
    await mkdir(join(isolatedHome, ".diligent"), { recursive: true });

    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = isolatedHome;
    process.env.USERPROFILE = isolatedHome;
    try {
      const first = await loadRuntimeConfig(tmpRoot, paths);
      const second = await loadRuntimeConfig(tmpRoot, paths);
      const stored = (await readFile(join(isolatedHome, ".diligent", "user-id"), "utf8")).trim();

      expect(first.diligent.userId).toBeDefined();
      expect(first.diligent.userId).toBe(second.diligent.userId);
      expect(first.diligent.userId).toBe(stored);
      expect(stored).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    } finally {
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
    }
  });

  it("prefers explicit config userId over the persisted fallback", async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "diligent-runtime-explicit-userid-"));
    const paths = makePaths(tmpRoot);
    const isolatedHome = join(tmpRoot, ".isolated-home");
    await mkdir(paths.sessions, { recursive: true });
    await mkdir(paths.knowledge, { recursive: true });
    await mkdir(paths.skills, { recursive: true });
    await mkdir(paths.images, { recursive: true });
    await mkdir(join(isolatedHome, ".diligent"), { recursive: true });
    await writeFile(join(tmpRoot, ".diligent", "config.jsonc"), JSON.stringify({ userId: "explicit-user" }));

    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = isolatedHome;
    process.env.USERPROFILE = isolatedHome;
    try {
      const config = await loadRuntimeConfig(tmpRoot, paths);
      const fallbackPath = join(isolatedHome, ".diligent", "user-id");

      expect(config.diligent.userId).toBe("explicit-user");
      expect(await Bun.file(fallbackPath).exists()).toBe(false);
    } finally {
      process.env.HOME = originalHome;
      process.env.USERPROFILE = originalUserProfile;
    }
  });
});
