// @summary Guards that every workspace package imported by runtime src is declared in its package.json
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PACKAGE_ROOT = join(import.meta.dir, "..");

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe("runtime package manifest", () => {
  // Consumers outside this monorepo (for example a repo that mounts diligent as a
  // submodule) resolve @diligent/* through package.json, not the root tsconfig paths.
  test("declares every @diligent/* package imported from src", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
    const declared = new Set(Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies }));

    const imported = new Set<string>();
    for (const file of listSourceFiles(join(PACKAGE_ROOT, "src"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["'](@diligent\/[a-z0-9-]+)/g)) {
        imported.add(match[1]);
      }
    }
    imported.delete(manifest.name);

    const undeclared = [...imported].filter((name) => !declared.has(name)).sort();
    expect(undeclared).toEqual([]);
  });
});
