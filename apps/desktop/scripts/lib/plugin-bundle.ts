// @summary Computes bundle plans for packaging third-party plugins into desktop defaults.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT_SKIP = new Set(["package.json", "tsconfig.json", "bun.lock", "bun.lockb"]);

interface SourcePackageJson {
  version?: string;
}

export interface PluginBundlePlan {
  buildCommand: string;
  buildCwd: string;
  outDir: string;
  outFile: string;
  outputPackageJson: {
    name: string;
    version: string;
    type: "module";
    main: "index.js";
  };
  assetFiles: string[];
}

export function getPluginAssetFiles(pluginDir: string): string[] {
  return readdirSync(pluginDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => !PLUGIN_ROOT_SKIP.has(entry.name))
    .filter((entry) => !entry.name.endsWith(".ts"))
    .map((entry) => entry.name);
}

export function createPluginBundlePlan(options: {
  rootDir: string;
  defaultsResourcesDir: string;
  pluginDir: string;
  pluginName: string;
}): PluginBundlePlan {
  const pluginEntry = join(options.pluginDir, "src/index.ts");
  const outDir = join(options.defaultsResourcesDir, "plugins", options.pluginName);
  const outFile = join(outDir, "index.js");
  const srcPkg = JSON.parse(readFileSync(join(options.pluginDir, "package.json"), "utf-8")) as SourcePackageJson;

  return {
    buildCommand: `bun build --target bun --outfile ${outFile} ${pluginEntry}`,
    buildCwd: options.rootDir,
    outDir,
    outFile,
    outputPackageJson: {
      name: options.pluginName,
      version: srcPkg.version ?? "0.1.0",
      type: "module",
      main: "index.js",
    },
    assetFiles: getPluginAssetFiles(options.pluginDir),
  };
}
