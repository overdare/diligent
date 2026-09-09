// @summary Verifies GUI builder discovery, packaged references, and documented Studio font assignments.
import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { discoverSkills, renderSkillsSection } from "@diligent/runtime/skills";
import { createSkillTool } from "@diligent/runtime/tools/skill";
import { parseArgs } from "../src/tools/studiorpc/methods/instance.upsert";
import { parseInstancePatchProperties } from "../src/tools/studiorpc/methods/instance-properties";

const bundledSkills = resolve(import.meta.dir, "../../bootstrap/skills");
const retiredNames = ["ui-generator", "overdare-ui-templates"];

test("loads only the renamed GUI builder and resolves its references after deployment", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "gui-builder-"));
  try {
    const skillRoot = join(cwd, "skills");
    await mkdir(skillRoot);
    for (const name of ["gui-builder", ...retiredNames]) {
      await cp(join(bundledSkills, name), join(skillRoot, name), { recursive: true });
    }
    const { skills, errors } = await discoverSkills({
      cwd,
      globalConfigDir: join(cwd, "global"),
      additionalPaths: [skillRoot],
    });
    expect(errors).toEqual([]);
    const tool = createSkillTool(skills);
    expect(tool.description).toContain("gui-builder:");
    expect(renderSkillsSection(skills)).toContain("gui-builder");
    for (const name of retiredNames) {
      expect(tool.description).not.toContain(`- ${name}:`);
      expect((await tool.execute({ name }, {} as never)).metadata?.error).toBe(true);
    }
    const loaded = await tool.execute({ name: "gui-builder" }, {} as never);
    expect(loaded.metadata?.error).not.toBe(true);
    expect(loaded.output).toContain('<skill_content name="gui-builder">');
    const baseDir = skills.find((skill) => skill.name === "gui-builder")!.baseDir;
    const links = [...loaded.output.matchAll(/\]\(((?:references|assets)\/[^)]+)\)/g)].map((match) => match[1]);
    expect(links.length).toBeGreaterThan(0);
    const visited = new Set<string>();
    async function verifyResource(path: string): Promise<void> {
      expect(relative(baseDir, path).startsWith("..")).toBe(false);
      if (visited.has(path)) return;
      visited.add(path);
      const bytes = await readFile(path);
      expect(bytes.length).toBeGreaterThan(0);
      if (path.endsWith(".png")) {
        expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      } else if (path.endsWith(".md")) {
        const body = bytes.toString("utf8");
        expect(loaded.output).not.toContain(body.trim());
        const nested = [...body.matchAll(/\]\(([^)]+\.(?:md|png))\)/g)].map((match) => match[1]);
        for (const link of nested) {
          if (!link.includes("://")) await verifyResource(resolve(dirname(path), link));
        }
      }
    }
    for (const path of links) await verifyResource(resolve(baseDir, path));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("documented font faces normalize without substituting their family, weight, or style", async () => {
  const reference = await readFile(join(bundledSkills, "gui-builder/references/fonts.md"), "utf8");
  const rows = reference.split("\n").filter((line) => /^\|[^|]+\|\s*\d+\s*\|/.test(line));
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    const [family, id, weights, styles] = row
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    for (const weight of weights.split(", ")) {
      for (const style of styles.split(", ")) {
        const face = { Family: `ovdrassetid://${id}`, Weight: weight, Style: style };
        for (const className of ["TextLabel", "TextButton"]) {
          const created = parseArgs({
            items: [{ class: className, parentGuid: "screen", name: family, properties: { FontFace: face } }],
          });
          const updated = parseInstancePatchProperties(className, { FontFace: face });
          expect(created.items[0].properties?.FontFace).toEqual({ ObjectType: "Font", ...face });
          expect(updated).toEqual({ FontFace: { ObjectType: "Font", ...face } });
        }
      }
    }
  }
  const example = reference.match(/```json\s*([\s\S]*?)```/);
  expect(example).not.toBeNull();
  const parsed = parseArgs(JSON.parse(example![1]));
  const inputFace = parsed.items[0].properties?.FontFace;
  expect(parseInstancePatchProperties("TextLabel", { FontFace: inputFace }).FontFace).toEqual({
    ObjectType: "Font",
    ...(inputFace as object),
  });
});
