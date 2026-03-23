// @summary Tests for user-defined agent discovery across precedence roots
import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAgents } from "../../src/agents/discovery";

let tmpDir: string;

async function createTmpDir(): Promise<string> {
  tmpDir = await mkdtemp(join(tmpdir(), "diligent-agents-test-"));
  return tmpDir;
}

afterEach(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

function makeAgentMd(name: string, description: string, extra?: string): string {
  const lines = ["---", `name: ${name}`, `description: ${description}`];
  if (extra) lines.push(extra);
  lines.push("---", "Review code carefully.");
  return lines.join("\n");
}

describe("discoverAgents", () => {
  it("discovers agent from project-local .diligent/agents", async () => {
    const root = await createTmpDir();
    const dir = join(root, ".diligent", "agents", "code-reviewer");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "AGENT.md"), makeAgentMd("code-reviewer", "Reviews code"));

    const result = await discoverAgents({ cwd: root });
    expect(result.errors).toHaveLength(0);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe("code-reviewer");
    expect(result.agents[0].source).toBe("project");
  });

  it("prefers project over config and global duplicates", async () => {
    const root = await createTmpDir();
    const projectDir = join(root, ".diligent", "agents", "reviewer");
    const configRoot = join(root, "extra-agents");
    const configDir = join(configRoot, "reviewer");
    const globalRoot = join(root, "global");
    const globalDir = join(globalRoot, "agents", "reviewer");
    await mkdir(projectDir, { recursive: true });
    await mkdir(configDir, { recursive: true });
    await mkdir(globalDir, { recursive: true });
    await writeFile(join(projectDir, "AGENT.md"), makeAgentMd("reviewer", "Project version"));
    await writeFile(join(configDir, "AGENT.md"), makeAgentMd("reviewer", "Config version"));
    await writeFile(join(globalDir, "AGENT.md"), makeAgentMd("reviewer", "Global version"));

    const result = await discoverAgents({ cwd: root, additionalPaths: [configRoot], globalConfigDir: globalRoot });
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].description).toBe("Project version");
  });

  it("reports same-tier collisions deterministically", async () => {
    const root = await createTmpDir();
    const configRootA = join(root, "extra-a");
    const configRootB = join(root, "extra-b");
    await mkdir(join(configRootA, "reviewer"), { recursive: true });
    await mkdir(join(configRootB, "reviewer"), { recursive: true });
    await writeFile(join(configRootA, "reviewer", "AGENT.md"), makeAgentMd("reviewer", "A"));
    await writeFile(join(configRootB, "reviewer", "AGENT.md"), makeAgentMd("reviewer", "B"));

    const result = await discoverAgents({ cwd: root, additionalPaths: [configRootA, configRootB] });
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].description).toBe("A");
  });

  it("rejects collisions with built-in names", async () => {
    const root = await createTmpDir();
    const dir = join(root, ".diligent", "agents", "general");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "AGENT.md"), makeAgentMd("general", "Override"));
    const result = await discoverAgents({ cwd: root });
    expect(result.agents).toHaveLength(0);
    expect(result.errors[0]?.error).toContain("collides with built-in");
  });
});
