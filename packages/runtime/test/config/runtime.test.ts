// @summary Tests for runtime config agent loading and prompt rendering
import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    await mkdir(paths.sessions, { recursive: true });
    await mkdir(paths.knowledge, { recursive: true });
    await mkdir(paths.skills, { recursive: true });
    await mkdir(paths.images, { recursive: true });
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

    const config = await loadRuntimeConfig(tmpRoot, paths);

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
});
