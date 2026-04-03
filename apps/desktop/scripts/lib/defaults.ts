// @summary Shared desktop defaults resource assembly for Tauri dev/build and packaging.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPluginBundlePlan } from "./plugin-bundle";

export type PrepareDefaultsResourcesConfig = {
  rootDir: string;
  desktopDir: string;
  packageDir?: string;
  run(command: string, cwd: string): void;
};

export function prepareDefaultsResources(config: PrepareDefaultsResourcesConfig): void {
  const defaultsSourceDir = join(config.desktopDir, "defaults");
  const defaultsResourcesDir = join(config.desktopDir, "src-tauri/resources/defaults");

  if (existsSync(defaultsResourcesDir)) {
    rmSync(defaultsResourcesDir, { recursive: true, force: true });
  }
  mkdirSync(defaultsResourcesDir, { recursive: true });
  mkdirSync(join(defaultsResourcesDir, "plugins"), { recursive: true });

  const configSrc = join(defaultsSourceDir, "config.jsonc");
  if (existsSync(configSrc)) {
    cpSync(configSrc, join(defaultsResourcesDir, "config.jsonc"));
    console.log("   Copied config.jsonc template");
  }

  if (!config.packageDir) return;
  if (!existsSync(config.packageDir)) {
    console.warn(`⚠️  --package dir not found, skipping: ${config.packageDir}`);
    return;
  }

  copyPackageRootFiles(config.packageDir, defaultsResourcesDir);
  bundlePackagePlugins({
    rootDir: config.rootDir,
    defaultsResourcesDir,
    packageDir: config.packageDir,
    run: config.run,
  });
  copyPackageSubdirectories(config.packageDir, defaultsResourcesDir);
}

function copyPackageRootFiles(packageDir: string, defaultsResourcesDir: string): void {
  const skipExtensions = new Set([".ts", ".js", ".mjs", ".lock", ".lockb"]);
  const skipFiles = new Set(["package.json", "tsconfig.json", "bun.lock", "bun.lockb"]);

  for (const entry of readdirSync(packageDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (skipFiles.has(entry.name)) continue;

    const extensionIndex = entry.name.lastIndexOf(".");
    const extension = extensionIndex >= 0 ? entry.name.slice(extensionIndex) : "";
    if (skipExtensions.has(extension)) continue;

    cpSync(join(packageDir, entry.name), join(defaultsResourcesDir, entry.name));
    console.log(`   Copied file:     ${entry.name}`);
  }
}

function bundlePackagePlugins(config: {
  rootDir: string;
  defaultsResourcesDir: string;
  packageDir: string;
  run(command: string, cwd: string): void;
}): void {
  const pluginsSubDir = join(config.packageDir, "plugins");
  if (!existsSync(pluginsSubDir)) return;

  for (const entry of readdirSync(pluginsSubDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const pluginDir = join(pluginsSubDir, entry.name);
    const pkgJsonPath = join(pluginDir, "package.json");
    if (!existsSync(join(pluginDir, "src/index.ts")) || !existsSync(pkgJsonPath)) continue;

    const pluginName = (JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as { name: string }).name;
    const plan = createPluginBundlePlan({
      rootDir: config.rootDir,
      defaultsResourcesDir: config.defaultsResourcesDir,
      pluginDir,
      pluginName,
    });

    mkdirSync(plan.outDir, { recursive: true });
    config.run(plan.buildCommand, plan.buildCwd);
    writeFileSync(join(plan.outDir, "package.json"), `${JSON.stringify(plan.outputPackageJson, null, 2)}\n`);
    console.log(`   Bundled plugin: ${pluginName} → ${plan.outFile}`);

    for (const fileName of plan.assetFiles) {
      cpSync(join(pluginDir, fileName), join(plan.outDir, fileName));
      console.log(`   Copied asset:   ${pluginName}/${fileName}`);
    }
  }
}

/** Directories to deploy into ~/.diligent/ at runtime. */
const DEPLOYABLE_DIRS = new Set(["agents", "skills"]);

function copyPackageSubdirectories(packageDir: string, defaultsResourcesDir: string): void {
  for (const entry of readdirSync(packageDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!DEPLOYABLE_DIRS.has(entry.name)) continue;

    const dest = join(defaultsResourcesDir, entry.name);
    mkdirSync(dest, { recursive: true });
    cpSync(join(packageDir, entry.name), dest, { recursive: true });
    console.log(`   Copied dir:      ${entry.name}/`);
  }
}
