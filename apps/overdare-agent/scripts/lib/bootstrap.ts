// @summary Shared desktop bootstrap resource assembly for Tauri dev/build and packaging.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPluginBundlePlan } from "./plugin-bundle";

export type PrepareBootstrapResourcesConfig = {
  rootDir: string;
  desktopDir: string;
  run(command: string, cwd: string): void;
};

export function prepareBootstrapResources(config: PrepareBootstrapResourcesConfig): void {
  const bootstrapSourceDir = join(config.desktopDir, "bootstrap");
  const bootstrapResourcesDir = join(config.desktopDir, "src-tauri/resources/bootstrap");

  if (existsSync(bootstrapResourcesDir)) {
    rmSync(bootstrapResourcesDir, { recursive: true, force: true });
  }
  mkdirSync(bootstrapResourcesDir, { recursive: true });
  mkdirSync(join(bootstrapResourcesDir, "plugins"), { recursive: true });

  const configSrc = join(bootstrapSourceDir, "config.jsonc");
  if (existsSync(configSrc)) {
    cpSync(configSrc, join(bootstrapResourcesDir, "config.jsonc"));
    console.log("   Copied config.jsonc template");
  }

  copyBootstrapRootFiles(bootstrapSourceDir, bootstrapResourcesDir);
  bundleAppPlugins({
    rootDir: config.rootDir,
    bootstrapResourcesDir,
    appDir: config.desktopDir,
    run: config.run,
  });
  copyBootstrapSubdirectories(bootstrapSourceDir, bootstrapResourcesDir);
}

function copyBootstrapRootFiles(bootstrapSourceDir: string, bootstrapResourcesDir: string): void {
  const skipExtensions = new Set([".ts", ".js", ".mjs", ".lock", ".lockb"]);
  const skipFiles = new Set(["package.json", "tsconfig.json", "bun.lock", "bun.lockb", ".DS_Store"]);
  for (const entry of readdirSync(bootstrapSourceDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (skipFiles.has(entry.name)) continue;

    const extensionIndex = entry.name.lastIndexOf(".");
    const extension = extensionIndex >= 0 ? entry.name.slice(extensionIndex) : "";
    if (skipExtensions.has(extension)) continue;

    const sourcePath = join(bootstrapSourceDir, entry.name);
    if (sourcePath === join(bootstrapSourceDir, "config.jsonc")) continue;
    cpSync(sourcePath, join(bootstrapResourcesDir, entry.name));
    console.log(`   Copied file:     ${entry.name}`);
  }
}

function bundleAppPlugins(config: {
  rootDir: string;
  bootstrapResourcesDir: string;
  appDir: string;
  run(command: string, cwd: string): void;
}): void {
  const pluginsSubDir = join(config.appDir, "plugins");
  if (!existsSync(pluginsSubDir)) return;

  for (const entry of readdirSync(pluginsSubDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const pluginDir = join(pluginsSubDir, entry.name);
    const pkgJsonPath = join(pluginDir, "package.json");
    if (!existsSync(join(pluginDir, "src/index.ts")) || !existsSync(pkgJsonPath)) continue;

    const pluginName = (JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as { name: string }).name;
    const plan = createPluginBundlePlan({
      rootDir: config.rootDir,
      bootstrapResourcesDir: config.bootstrapResourcesDir,
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

function copyBootstrapSubdirectories(bootstrapSourceDir: string, bootstrapResourcesDir: string): void {
  for (const entry of readdirSync(bootstrapSourceDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const dest = join(bootstrapResourcesDir, entry.name);
    mkdirSync(dest, { recursive: true });
    cpSync(join(bootstrapSourceDir, entry.name), dest, { recursive: true });
    console.log(`   Copied dir:      ${entry.name}/`);
  }
}
