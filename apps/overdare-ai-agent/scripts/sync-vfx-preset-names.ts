// @summary Refreshes exact preset inputs from Studio config and its installed preset asset inventory.
// Usage: bun scripts/sync-vfx-preset-names.ts <CommonContent-directory> <plugins-revision>
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { annotatePresetCatalog } from "./vfx-preset-catalog";

const [rootArg, pluginsRevision] = process.argv.slice(2);
if (!rootArg || !pluginsRevision) throw new Error("Expected CommonContent directory and plugins revision");
const root = resolve(rootArg);
const config = await readFile(join(root, "Config/DefaultCommonContent.ini"), "utf8");
const configured = new Map(
  [...config.matchAll(/^(VFX_[^=]+)=\(Name="([^"]*)"/gm)].map((m) => [m[1].toLowerCase(), m[2]]),
);
const assets = new Map<string, string>();
for await (const path of new Bun.Glob("**/*.uasset").scan(join(root, "Content/VFX/Preset/Particle"))) {
  const name = path
    .replaceAll("\\", "/")
    .split("/")
    .at(-1)!
    .replace(/\.uasset$/, "");
  assets.set(name.toLowerCase(), name);
}
const catalogPath = join(import.meta.dir, "../bootstrap/skills/vfx-recipe/references/presets.md");
const source = await readFile(catalogPath, "utf8");
const names: Record<string, string> = {};
for (const row of source.split("\n").filter((line) => line.startsWith("| VFX_"))) {
  const resource = row.split("|")[1].trim();
  const key = resource.toLowerCase();
  const assetName = assets.get(key);
  if (assetName) names[resource] = configured.get(key) ?? assetName;
}
const snapshot = {
  source:
    "Sandbox/Plugins/CommonContent/Config/DefaultCommonContent.ini and Content/VFX/Preset/Particle asset inventory",
  pluginsRevision,
  names: Object.fromEntries(Object.entries(names).sort(([a], [b]) => a.localeCompare(b))),
};
await writeFile(
  join(import.meta.dir, "../sidecar/src/tools/studiorpc/methods/vfx-preset-names.json"),
  `${JSON.stringify(snapshot, null, 2)}\n`,
);
await writeFile(catalogPath, annotatePresetCatalog(source, names));
console.log(`Updated ${Object.keys(names).length} native preset names from ${pluginsRevision}`);
