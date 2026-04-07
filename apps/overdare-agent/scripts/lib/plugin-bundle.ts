// @summary Computes bundle plans for packaging app plugins into desktop bootstrap resources.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PLUGIN_ROOT_SKIP = new Set(["package.json", "tsconfig.json", "bun.lock", "bun.lockb"]);

interface SourcePackageJson {
  version?: string;
}

export interface PluginBundlePlan {
  buildArgs: string[];
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
  bootstrapResourcesDir: string;
  pluginDir: string;
  pluginName: string;
}): PluginBundlePlan {
  const pluginEntry = join(options.pluginDir, "src/index.ts");
  const outDir = join(options.bootstrapResourcesDir, "plugins", options.pluginName);
  const outFile = join(outDir, "index.js");
  const srcPkg = JSON.parse(readFileSync(join(options.pluginDir, "package.json"), "utf-8")) as SourcePackageJson;

  // Inject build-time defines (e.g. analytics API key from CI secrets).
  // Only alphanumeric + underscore + hyphen values are allowed to prevent shell injection.
  const SAFE_VALUE = /^[\w\-.]+$/;
  const defineArgs = Object.entries(process.env)
    .filter(([k]) => k.startsWith("PLUGIN_DEFINE_"))
    .filter(([, v]) => v && SAFE_VALUE.test(v))
    .flatMap(([k, v]) => ["--define", `__${k.slice("PLUGIN_DEFINE_".length)}__="${v}"`]);

  return {
    buildArgs: ["bun", "build", "--target", "bun", ...defineArgs, "--outfile", outFile, pluginEntry],
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
