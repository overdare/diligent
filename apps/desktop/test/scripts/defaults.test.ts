// @summary Regression tests for desktop defaults resource assembly used by dev/build and packaging.

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareDefaultsResources } from "../../scripts/lib/defaults";

test("prepareDefaultsResources creates Tauri defaults resources from desktop defaults", () => {
  const rootDir = join(tmpdir(), `desktop-defaults-root-${Date.now()}`);
  const desktopDir = join(rootDir, "apps/desktop");
  const defaultsDir = join(desktopDir, "defaults");
  const defaultsResourcesDir = join(desktopDir, "src-tauri/resources/defaults");

  mkdirSync(defaultsDir, { recursive: true });
  writeFileSync(join(defaultsDir, "config.jsonc"), '{"ok":true}\n');

  try {
    prepareDefaultsResources({
      rootDir,
      desktopDir,
      run() {
        throw new Error("run should not be called without a packageDir");
      },
    });

    expect(existsSync(join(defaultsResourcesDir, "plugins"))).toBe(true);
    expect(readFileSync(join(defaultsResourcesDir, "config.jsonc"), "utf-8")).toBe('{"ok":true}\n');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("prepareDefaultsResources only copies deployable directories from package root", () => {
  const rootDir = join(tmpdir(), `desktop-defaults-package-root-${Date.now()}`);
  const desktopDir = join(rootDir, "apps/desktop");
  const defaultsDir = join(desktopDir, "defaults");
  const defaultsResourcesDir = join(desktopDir, "src-tauri/resources/defaults");
  const packageDir = join(rootDir, "package");

  mkdirSync(defaultsDir, { recursive: true });
  writeFileSync(join(defaultsDir, "config.jsonc"), '{"ok":true}\n');

  mkdirSync(join(packageDir, "agents"), { recursive: true });
  writeFileSync(join(packageDir, "agents", "agent.md"), "# agent\n");

  mkdirSync(join(packageDir, "skills"), { recursive: true });
  writeFileSync(join(packageDir, "skills", "skill.md"), "# skill\n");

  mkdirSync(join(packageDir, "icons"), { recursive: true });
  writeFileSync(join(packageDir, "icons", "icon.png"), "png");

  mkdirSync(join(packageDir, "scripts"), { recursive: true });
  writeFileSync(join(packageDir, "scripts", "tool.ts"), "console.log('dev script');\n");

  mkdirSync(join(packageDir, "supabase", "functions"), { recursive: true });
  writeFileSync(join(packageDir, "supabase", "functions", "index.ts"), "export {}\n");

  try {
    prepareDefaultsResources({
      rootDir,
      desktopDir,
      packageDir,
      run() {
        // No plugins in this test case; bundling command should not be called.
      },
    });

    expect(existsSync(join(defaultsResourcesDir, "agents", "agent.md"))).toBe(true);
    expect(existsSync(join(defaultsResourcesDir, "skills", "skill.md"))).toBe(true);

    expect(existsSync(join(defaultsResourcesDir, "icons"))).toBe(false);
    expect(existsSync(join(defaultsResourcesDir, "scripts"))).toBe(false);
    expect(existsSync(join(defaultsResourcesDir, "supabase"))).toBe(false);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
