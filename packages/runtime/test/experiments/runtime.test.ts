// @summary Verifies experiment state gates the effective runtime skill and tool names together.

import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRuntimeConfig } from "../../src/config/runtime";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("runtime experiment gating", () => {
  it("removes both managed skill and tool by default and restores both from one override", async () => {
    const home = await mkdtemp(join(tmpdir(), "diligent-experiment-home-"));
    const cwd = await mkdtemp(join(tmpdir(), "diligent-experiment-project-"));
    tempDirs.push(home, cwd);
    const originalHome = process.env.HOME;
    process.env.HOME = home;
    const skillDir = join(cwd, ".diligent", "skills", "preview-skill");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: preview-skill\ndescription: Preview test skill\n---\nUse preview_tool.",
    );
    const agentDir = join(cwd, ".diligent", "agents", "preview-agent");
    await mkdir(agentDir, { recursive: true });
    await writeFile(
      join(agentDir, "AGENT.md"),
      "---\nname: preview-agent\ndescription: Preview test agent\ntools: read\n---\nUse the preview capability.",
    );
    const paths = {
      root: join(cwd, ".diligent"),
      sessions: join(cwd, ".diligent", "sessions"),
      knowledge: join(cwd, ".diligent", "knowledge"),
      skills: join(cwd, ".diligent", "skills"),
      images: join(cwd, ".diligent", "images"),
    };
    const experimentDefinitions = [
      {
        id: "preview",
        title: "Preview feature",
        description: "Preview capability",
        defaultEnabled: false,
        toolNames: ["preview_tool"],
        skillNames: ["preview-skill"],
        agentNames: ["preview-agent"],
      },
    ];

    try {
      const disabled = await loadRuntimeConfig(cwd, paths, { experimentDefinitions });
      expect(disabled.skills.map((skill) => skill.name)).not.toContain("preview-skill");
      expect(disabled.disabledToolNames).toEqual(new Set(["preview_tool"]));
      expect(disabled.agentCatalog.map((entry) => entry.definition.name)).toContain("preview-agent");
      expect(disabled.agentDefinitions.map((definition) => definition.name)).not.toContain("preview-agent");

      await mkdir(join(home, ".diligent"), { recursive: true });
      await writeFile(
        join(home, ".diligent", "config.jsonc"),
        JSON.stringify({
          experiments: { overrides: { preview: true } },
          agents: { overrides: { "preview-agent": false } },
        }),
      );
      const enabled = await loadRuntimeConfig(cwd, paths, { experimentDefinitions });
      expect(enabled.skills.map((skill) => skill.name)).toContain("preview-skill");
      expect(enabled.disabledToolNames.size).toBe(0);
      expect(enabled.agentDefinitions.map((definition) => definition.name)).toContain("preview-agent");
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });
});
