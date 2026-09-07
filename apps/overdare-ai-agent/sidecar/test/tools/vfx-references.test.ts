import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REF_DIR = join(import.meta.dir, "../../../bootstrap/skills/vfx-recipe/references");
// The bundled source catalog is documentation, not an editable-class whitelist.
const sourcesText = readFileSync(join(REF_DIR, "sources.md"), "utf8");
const sourcePaths = new Set([...sourcesText.matchAll(/^- \*\*NiagaraSystem\*\*:\s*`(.+)`/gm)].map((match) => match[1]));

describe("vfx-recipe bundled references", () => {
  test("presets.md has the full catalog in grep format", () => {
    const rows = readFileSync(join(REF_DIR, "presets.md"), "utf8")
      .split("\n")
      .filter((line) => line.startsWith("| VFX_"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // | Resource | DisplayName | Category | Subcategory | Genre | Keywords |
      const cells = row.split("|").map((c) => c.trim());
      expect(cells[1]).toMatch(/^VFX_/);
      expect(cells.length).toBe(8); // leading/trailing empty + 6 columns
    }
  });

  test("every template NiagaraSystem path references the bundled source documentation", () => {
    const templateDir = join(REF_DIR, "templates");
    const files = readdirSync(templateDir).filter((f) => f.startsWith("combo_"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const content = readFileSync(join(templateDir, file), "utf8");
      const refs = [...content.matchAll(/\/CommonContent\/VFX\/Layer\/(0_Base|1_Detail|2_Extra)\/([A-Za-z0-9_]+)\//g)];
      expect(refs.length).toBeGreaterThan(0);
      for (const [, layer, source] of refs) {
        expect([...sourcePaths].some((path) => path.includes(`/Layer/${layer}/${source}/`))).toBe(true);
      }
    }
  });

  test("00_INDEX.md lists exactly the bundled template files", () => {
    const templateDir = join(REF_DIR, "templates");
    const files = readdirSync(templateDir)
      .filter((f) => f.startsWith("combo_"))
      .sort();
    const index = readFileSync(join(templateDir, "00_INDEX.md"), "utf8");
    const listed = [...index.matchAll(/\*\*(combo_[^*]+)\*\*/g)].map((m) => m[1]).sort();
    expect(listed).toEqual(files);
  });

  test("every sources.md entry has a matching layer and NiagaraSystem path", () => {
    const layerDir: Record<string, string> = { Base: "0_Base", Detail: "1_Detail", Extra: "2_Extra" };

    const src = readFileSync(join(REF_DIR, "sources.md"), "utf8");
    const entries: { resourceName: string; niagaraSystem: string; layer: string }[] = [];
    let cur: Partial<{ resourceName: string; niagaraSystem: string; layer: string }> = {};
    for (const line of src.split("\n")) {
      const rn = line.match(/^- \*\*Resource Name\*\*:\s*(\S+)/);
      const ns = line.match(/^- \*\*NiagaraSystem\*\*:\s*`(.+)`/);
      const layer = line.match(/^- \*\*Layer\*\*:\s*(\S+)/);
      if (rn) {
        if (cur.resourceName) entries.push(cur as (typeof entries)[number]);
        cur = { resourceName: rn[1] };
      }
      if (ns) cur.niagaraSystem = ns[1];
      if (layer) cur.layer = layer[1];
    }
    if (cur.resourceName) entries.push(cur as (typeof entries)[number]);
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      const m = entry.resourceName.match(/^VFX_UGC_(Base|Detail|Extra)_(.+)$/);
      expect(m).not.toBeNull();
      const [, layer, shortName] = m as RegExpMatchArray;
      expect(entry.layer).toBe(layer);
      const expectedPath = `/CommonContent/VFX/Layer/${layerDir[layer]}/${shortName}/VFX_UGC_${layer}_${shortName}.VFX_UGC_${layer}_${shortName}`;
      expect(entry.niagaraSystem).toBe(expectedPath);
    }
  });
});
