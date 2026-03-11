// @summary Deploy overdare plugins to ~/.diligent/plugins/ for local development
//
// Usage:
//   bun run deploy                  # deploy all plugins
//   bun run deploy plugin-studiorpc # deploy a single plugin by directory name
//
// Each plugin is bundled with `bun build --target bun` and installed to:
//   ~/.diligent/plugins/@overdare/<pluginName>/
//
// Diligent auto-discovers scoped plugins by scanning ~/.diligent/plugins/@<scope>/<name>.

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const OVERDARE_DIR = join(import.meta.dir, "..");
const PLUGINS_DIR = join(OVERDARE_DIR, "plugins");

/** Files at plugin root that should NOT be copied as runtime assets. */
const SKIP_FILES = new Set(["package.json", "tsconfig.json", "bun.lock", "bun.lockb"]);

function run(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, stdio: "inherit" });
}

function getDeployRoot(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? homedir();
  return join(home, ".diligent", "plugins");
}

interface PluginMeta {
  dirName: string;
  dirPath: string;
  packageName: string; // e.g. "@overdare/plugin-studiorpc"
  version: string;
}

function readPluginMeta(dirPath: string): PluginMeta | null {
  const pkgPath = join(dirPath, "package.json");
  const entryPath = join(dirPath, "src/index.ts");
  if (!existsSync(pkgPath) || !existsSync(entryPath)) return null;

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string; version?: string };
  if (!pkg.name || !pkg.version) return null;

  return {
    dirName: dirPath.split(/[\\/]/).at(-1)!,
    dirPath,
    packageName: pkg.name,
    version: pkg.version,
  };
}

function deployPlugin(meta: PluginMeta): void {
  const { dirPath, packageName, version } = meta;
  const deployRoot = getDeployRoot();

  // Deploy path: ~/.diligent/plugins/@overdare/plugin-studiorpc/
  const deployDir = join(deployRoot, packageName);

  console.log(`\n📦 ${packageName} @ ${version}`);
  console.log(`   src  : ${dirPath}`);
  console.log(`   dest : ${deployDir}`);

  // 1. Install dependencies
  console.log("   → bun install");
  run("bun install", dirPath);

  // 2. Bundle to a temp output dir, then move to deploy dir
  const outFile = join(deployDir, "index.js");
  mkdirSync(deployDir, { recursive: true });

  console.log("   → bun build");
  run(`bun build src/index.ts --target bun --outfile ${outFile}`, dirPath);

  // 3. Write minimal package.json so import(dirUrl) resolves to index.js
  const pkgJson = {
    name: packageName,
    version,
    type: "module",
    main: "index.js",
  };
  writeFileSync(join(deployDir, "package.json"), `${JSON.stringify(pkgJson, null, 2)}\n`);

  // 4. Copy asset files from plugin root (binaries, type defs, etc.)
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    if (entry.name.endsWith(".ts")) continue;
    const src = join(dirPath, entry.name);
    const dst = join(deployDir, entry.name);
    cpSync(src, dst);
    console.log(`   → copied asset: ${entry.name}`);
  }

  console.log(`   ✓ deployed`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const filterArg = process.argv[2]; // optional: directory name filter, e.g. "plugin-studiorpc"

// Collect all valid plugin directories
const allPlugins: PluginMeta[] = [];
for (const entry of readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const meta = readPluginMeta(join(PLUGINS_DIR, entry.name));
  if (meta) allPlugins.push(meta);
}

if (allPlugins.length === 0) {
  console.error(`No plugins found in ${PLUGINS_DIR}`);
  process.exit(1);
}

// Apply optional filter
const targets = filterArg
  ? allPlugins.filter((p) => p.dirName === filterArg || p.packageName === filterArg)
  : allPlugins;

if (targets.length === 0) {
  console.error(`Plugin not found: "${filterArg}"`);
  console.error(`Available: ${allPlugins.map((p) => p.dirName).join(", ")}`);
  process.exit(1);
}

const deployRoot = getDeployRoot();
console.log(`\n🚀 Deploying ${targets.length} plugin(s) to ${deployRoot}`);

let failed = 0;
for (const meta of targets) {
  try {
    deployPlugin(meta);
  } catch (err) {
    console.error(`\n❌ Failed to deploy ${meta.packageName}:`);
    console.error(err instanceof Error ? err.message : String(err));
    failed++;
  }
}

console.log(`\n${failed === 0 ? "✓ All plugins deployed successfully." : `⚠️  ${failed} plugin(s) failed.`}\n`);
if (failed > 0) process.exit(1);
