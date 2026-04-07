// @summary Regression tests for plugin bundle planning used by desktop packaging.

import { expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPluginBundlePlan, getPluginAssetFiles } from "../../scripts/lib/plugin-bundle";

test("createPluginBundlePlan builds plugins from the repo root without running install", () => {
  const rootDir = join(tmpdir(), `desktop-plugin-root-${Date.now()}`);
  const pluginDir = join(rootDir, "thirdparty/plugin-example");
  const bootstrapResourcesDir = join(rootDir, "apps/overdare-agent/src-tauri/resources/bootstrap");

  mkdirSync(join(pluginDir, "src"), { recursive: true });
  writeFileSync(join(pluginDir, "src", "index.ts"), "export const ok = true;\n");
  writeFileSync(join(pluginDir, "package.json"), JSON.stringify({ version: "1.2.3" }));

  try {
    const plan = createPluginBundlePlan({
      rootDir,
      bootstrapResourcesDir,
      pluginDir,
      pluginName: "@acme/plugin-example",
    });

    expect(plan.buildCwd).toBe(rootDir);
    expect(plan.buildCommand).toContain("bun build --target bun");
    expect(plan.buildCommand).toContain("--outfile");
    expect(plan.buildCommand).not.toContain("bun install");
    expect(plan.outputPackageJson).toEqual({
      name: "@acme/plugin-example",
      version: "1.2.3",
      type: "module",
      main: "index.js",
    });
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("getPluginAssetFiles skips source and lock files while keeping runtime assets", () => {
  const pluginDir = join(tmpdir(), `desktop-plugin-assets-${Date.now()}`);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, "package.json"), "{}");
  writeFileSync(join(pluginDir, "tsconfig.json"), "{}");
  writeFileSync(join(pluginDir, "bun.lock"), "lock");
  writeFileSync(join(pluginDir, "helper.ts"), "export {};\n");
  writeFileSync(join(pluginDir, "overdare-types.d.lua"), "-- types\n");
  writeFileSync(join(pluginDir, "luau-lsp.exe"), "binary\n");

  try {
    expect(getPluginAssetFiles(pluginDir)).toEqual(["luau-lsp.exe", "overdare-types.d.lua"]);
  } finally {
    rmSync(pluginDir, { recursive: true, force: true });
  }
});
