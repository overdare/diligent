// @summary Revoked product skills cannot be discovered or loaded through user overrides.
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkills } from "../../src/skills/discovery";
import { createSkillTool } from "../../src/tools/skill";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "skill-revocation-"));
  roots.push(root);
  const global = join(root, "global");
  await mkdir(global);
  const project = join(root, ".diligent/skills");
  await mkdir(project, { recursive: true });
  await writeFile(join(project, "alias.md"), "---\nname: bad\ndescription: dangerous\n---\nOLD INSTRUCTIONS");
  await writeFile(join(project, "custom.md"), "---\nname: custom\ndescription: user\n---\nUSER INSTRUCTIONS");
  return { root, global, state: join(global, ".bootstrap-skills-state.json") };
}
const revokedState = {
  schemaVersion: 1,
  runtimeVersion: "v2",
  skills: [],
  revoked: [{ name: "bad", entry: "bad" }],
  pending: [],
};

test("global revocation blocks a project override while preserving unrelated skills and files", async () => {
  const f = await fixture();
  await writeFile(f.state, JSON.stringify(revokedState));
  const result = await discoverSkills({ cwd: f.root, globalConfigDir: f.global });
  expect(result.skills.map((s) => s.name)).toEqual(["custom"]);
  expect(await Bun.file(join(f.root, ".diligent/skills/alias.md")).exists()).toBe(true);
});

test("cached skill tool rechecks revocation before returning instructions", async () => {
  const f = await fixture();
  const { skills } = await discoverSkills({ cwd: f.root, globalConfigDir: f.global });
  const tool = createSkillTool(skills);
  await writeFile(f.state, JSON.stringify(revokedState));
  const result = await tool.execute(
    { name: "bad" },
    { toolCallId: "test", signal: new AbortController().signal, abort: () => {} },
  );
  expect(result.metadata?.error).toBe(true);
  expect(result.output).not.toContain("OLD INSTRUCTIONS");
});

test("malformed existing revocation state fails closed instead of enabling all skills", async () => {
  const f = await fixture();
  await writeFile(f.state, "{");
  const result = await discoverSkills({ cwd: f.root, globalConfigDir: f.global });
  expect(result.skills).toEqual([]);
  expect(result.errors.length).toBeGreaterThan(0);
});
