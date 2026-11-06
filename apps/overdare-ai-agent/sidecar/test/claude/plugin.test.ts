// @summary Native plugin sharing, metadata conversion, and original-file preservation.
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prepareClaudePlugin } from "../../src/claude/plugin";

const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "overdare-native-plugin-"));
  temporary.push(root);
  return root;
}
test("plugin shares original skills directly and reflects updates without a second skill tree", async () => {
  const root = await fixture();
  const dir = join(root, "skills", "image-asset-generation");
  await mkdir(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  await writeFile(file, "Original instructions");
  const first = await prepareClaudePlugin(root);
  expect(first.path).toBe(resolve(root));
  const manifestPath = join(first.path, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  expect(manifest.name).toBe("overdare");
  expect(manifest.agents).toEqual([]);
  expect(await readFile(file, "utf8")).toBe("Original instructions");
  await writeFile(file, "Updated instructions");
  const second = await prepareClaudePlugin(root);
  expect(second.path).toBe(first.path);
  expect(await readFile(join(second.path, "skills", "image-asset-generation", "SKILL.md"), "utf8")).toBe(
    "Updated instructions",
  );
});
test("native agents convert model and tool metadata without modifying originals", async () => {
  const root = await fixture();
  const dir = join(root, "agents", "studio-explorer");
  await mkdir(dir, { recursive: true });
  const original =
    "---\nname: studio-explorer\ndescription: Inspect the level\nmodel_class: lite\ntools: read, glob, studiorpc_level_browse\n---\nInspect only; never edit.\n";
  await writeFile(join(dir, "AGENT.md"), original);
  const [first, second] = await Promise.all([prepareClaudePlugin(root), prepareClaudePlugin(root)]);
  expect(first.agents["studio-explorer"]).toEqual({
    description: "Inspect the level",
    prompt: "Inspect only; never edit.\n",
    model: "haiku",
    tools: ["Read", "Glob", "mcp__overdare__studiorpc_level_browse"],
  });
  expect(second.agents).toEqual(first.agents);
  expect(await readFile(join(dir, "AGENT.md"), "utf8")).toBe(original);
});
test("revocation metadata is preserved for prompt guidance and malformed policy fails closed", async () => {
  const root = await fixture();
  await writeFile(
    join(root, ".bootstrap-skills-state.json"),
    JSON.stringify({
      schemaVersion: 1,
      revoked: [{ name: "retired", entry: "retired" }],
    }),
  );
  expect((await prepareClaudePlugin(root)).revokedSkills).toEqual(["retired"]);
  await writeFile(join(root, ".bootstrap-skills-state.json"), "invalid policy");
  await expect(prepareClaudePlugin(root)).rejects.toThrow("revocation");
});
