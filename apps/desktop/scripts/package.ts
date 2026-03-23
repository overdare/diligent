// @summary Desktop packaging orchestrator — builds Tauri desktop app and assembles dist/

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { generateChecksums } from "./lib/checksum";
import { ALL_PLATFORMS, filterPlatforms, type PlatformTarget } from "./lib/platforms";
import { createPluginBundlePlan } from "./lib/plugin-bundle";
import { resolveDesktopIconPaths, resolveProjectName, toProjectArtifactName } from "./lib/project-name";
import { rustSourcesChanged, saveRustHash } from "./lib/rust-cache";
import { injectVersion, restoreVersion, toTauriVersion, type VersionBackup } from "./lib/version";

const ROOT = join(import.meta.dir, "../../..");
const DESKTOP = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const TAURI_TEMP_ICONS_REL_DIR = ".diligent-packaging-icons";
const TAURI_TEMP_ICONS_DIR = join(DESKTOP, "src-tauri", TAURI_TEMP_ICONS_REL_DIR);

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: false,
  strict: false,
  options: {
    version: { type: "string" },
    platforms: { type: "string", default: ALL_PLATFORMS.map((p) => p.id).join(",") },
    package: { type: "string" },
  },
});

if (!values.version) {
  console.error("Usage: bun run scripts/package.ts --version <semver> [--platforms p1,p2] [--package <dir>]");
  process.exit(1);
}

const version = values.version;
const platformIds = values.platforms!.split(",").map((s) => s.trim());
const platforms = filterPlatforms(platformIds);

// Optional extra package directory passed via --package (resolved relative to repo root)
const extraPackageDir: string | undefined = values.package ? resolve(ROOT, values.package) : undefined;
const projectName = resolveProjectName(extraPackageDir);
const projectArtifactName = toProjectArtifactName(projectName);
const desktopIconPaths = resolveDesktopIconPaths(extraPackageDir);

// ---------------------------------------------------------------------------
// OS detection — Tauri can only produce native bundles for the current OS
// ---------------------------------------------------------------------------

function currentOs(): "darwin" | "linux" | "windows" {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux") return "linux";
  return "windows";
}

// ---------------------------------------------------------------------------
// Build helpers
// ---------------------------------------------------------------------------

function run(cmd: string, cwd: string = ROOT, env?: NodeJS.ProcessEnv): void {
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
}

function buildWebFrontend(): void {
  run("bun run build", join(ROOT, "packages/web"), {
    VITE_APP_PROJECT_NAME: projectName,
  });
}

// ---------------------------------------------------------------------------
// Defaults assembly — bundled plugin(s) + default config → resources/defaults/
// ---------------------------------------------------------------------------

const DEFAULTS_SRC = join(DESKTOP, "defaults");
const DEFAULTS_RESOURCES = join(DESKTOP, "src-tauri/resources/defaults");

/**
 * Bundle a plugin directory to a single ESM file using `bun build`.
 * Output: resources/defaults/plugins/<pluginName>/index.js + package.json
 *
 * Also copies any non-source asset files (e.g. binaries, .d.lua) from the
 * plugin root directory alongside the bundled output.
 */
function bundlePlugin(pluginDir: string, pluginName: string): void {
  const plan = createPluginBundlePlan({
    rootDir: ROOT,
    defaultsResourcesDir: DEFAULTS_RESOURCES,
    pluginDir,
    pluginName,
  });
  const outDir = plan.outDir;
  mkdirSync(outDir, { recursive: true });

  run(plan.buildCommand, plan.buildCwd);

  writeFileSync(join(outDir, "package.json"), `${JSON.stringify(plan.outputPackageJson, null, 2)}\n`);
  console.log(`   Bundled plugin: ${pluginName} → ${plan.outFile}`);

  for (const fileName of plan.assetFiles) {
    cpSync(join(pluginDir, fileName), join(outDir, fileName));
    console.log(`   Copied asset:   ${pluginName}/${fileName}`);
  }
}

function assembleDefaults(packageDir: string | undefined): void {
  // Clean and recreate defaults resources dir
  if (existsSync(DEFAULTS_RESOURCES)) {
    rmSync(DEFAULTS_RESOURCES, { recursive: true, force: true });
  }
  mkdirSync(DEFAULTS_RESOURCES, { recursive: true });

  // Ensure plugins/ directory always exists (required by tauri.conf.json resources)
  mkdirSync(join(DEFAULTS_RESOURCES, "plugins"), { recursive: true });

  // Copy default config template
  const configSrc = join(DEFAULTS_SRC, "config.jsonc");
  if (existsSync(configSrc)) {
    cpSync(configSrc, join(DEFAULTS_RESOURCES, "config.jsonc"));
    console.log("   Copied config.jsonc template");
  }

  // Bundle plugins from --package directory
  if (packageDir) {
    if (!existsSync(packageDir)) {
      console.warn(`⚠️  --package dir not found, skipping: ${packageDir}`);
    } else {
      // Copy config and resource files from package root (skip source/build artifacts)
      const SKIP_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".lock", ".lockb"]);
      const SKIP_FILES = new Set(["package.json", "tsconfig.json", "bun.lock", "bun.lockb"]);
      for (const entry of readdirSync(packageDir, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (SKIP_FILES.has(entry.name)) continue;
        if (SKIP_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf(".")))) continue;
        cpSync(join(packageDir, entry.name), join(DEFAULTS_RESOURCES, entry.name));
        console.log(`   Copied file:     ${entry.name}`);
      }

      // Bundle plugins from plugins/ subdirectory (new structure)
      const pluginsSubDir = join(packageDir, "plugins");
      if (existsSync(pluginsSubDir)) {
        for (const entry of readdirSync(pluginsSubDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const subDir = join(pluginsSubDir, entry.name);
          const pkgJsonPath = join(subDir, "package.json");
          if (existsSync(join(subDir, "src/index.ts")) && existsSync(pkgJsonPath)) {
            const pluginName = (JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as { name: string }).name;
            bundlePlugin(subDir, pluginName);
          }
        }
      }

      // Copy plain subdirectories (docs, assets, etc.) directly under defaults/
      for (const entry of readdirSync(packageDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name === "plugins") continue; // already handled above
        if (entry.name === "node_modules") continue;
        const dest = join(DEFAULTS_RESOURCES, entry.name);
        mkdirSync(dest, { recursive: true });
        cpSync(join(packageDir, entry.name), dest, { recursive: true });
        console.log(`   Copied dir:      ${entry.name}/`);
      }
    }
  }
}

function buildSidecar(plat: PlatformTarget): void {
  run("bun run build:sidecar", DESKTOP, {
    TAURI_TARGET_TRIPLE: plat.tauriTriple,
  });
}

function buildDesktop(plat: PlatformTarget): void {
  const tauriDir = join(DESKTOP, "src-tauri");

  // Copy web frontend into Tauri resource tree
  const clientDist = join(ROOT, "packages/web/dist/client");
  const resourceDist = join(tauriDir, "resources/dist/client");
  cpSync(clientDist, resourceDist, { recursive: true });

  buildSidecar(plat);

  if (rustSourcesChanged(tauriDir)) {
    console.log("   Rust sources changed — full compile");
    run("bunx tauri build", DESKTOP, {
      TAURI_TARGET_TRIPLE: plat.tauriTriple,
      DILIGENT_APP_PROJECT_NAME: projectName,
    });
    saveRustHash(tauriDir);
  } else {
    console.log("   Rust sources unchanged — skipping compile, bundling only");
    run("bunx tauri bundle", DESKTOP, {
      TAURI_TARGET_TRIPLE: plat.tauriTriple,
      DILIGENT_APP_PROJECT_NAME: projectName,
    });
  }
}

function applyDesktopIconOverrides(iconPaths: string[] | undefined): string[] | undefined {
  if (!iconPaths || iconPaths.length === 0) return undefined;

  if (existsSync(TAURI_TEMP_ICONS_DIR)) {
    rmSync(TAURI_TEMP_ICONS_DIR, { recursive: true, force: true });
  }
  mkdirSync(TAURI_TEMP_ICONS_DIR, { recursive: true });

  const copiedIcons: string[] = [];
  for (const [index, sourcePath] of iconPaths.entries()) {
    const fileName = sourcePath.split(/[/\\]/).at(-1);
    if (!fileName) continue;
    const targetName = `${index + 1}-${fileName}`;
    const destPath = join(TAURI_TEMP_ICONS_DIR, targetName);
    cpSync(sourcePath, destPath);
    copiedIcons.push(`${TAURI_TEMP_ICONS_REL_DIR}/${targetName}`);
  }

  return copiedIcons.length > 0 ? copiedIcons : undefined;
}

function cleanupDesktopIconOverrides(): void {
  if (!existsSync(TAURI_TEMP_ICONS_DIR)) return;
  rmSync(TAURI_TEMP_ICONS_DIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Artifact collection helpers
// ---------------------------------------------------------------------------

function findFirst(dir: string, ext: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  return readdirSync(dir)
    .filter((e) => e.endsWith(ext))
    .map((e) => join(dir, e))
    .at(0);
}

function copyArtifact(src: string, destDir: string, destName: string, list: string[]): void {
  const dest = join(destDir, destName);
  // If destination exists and is locked, remove it first then retry
  if (existsSync(dest)) {
    try {
      rmSync(dest, { recursive: true, force: true });
    } catch {
      // Ignore — cpSync will fail with a clear error if still locked
    }
  }
  if (statSync(src).isDirectory()) {
    cpSync(src, dest, { recursive: true });
  } else {
    cpSync(src, dest);
  }
  list.push(destName);
}

function collectDesktopArtifacts(plat: PlatformTarget, platDir: string, list: string[]): void {
  const bundleDir = join(DESKTOP, "src-tauri/target/release/bundle");
  const releaseDir = join(DESKTOP, "src-tauri/target/release");

  // Raw binary
  const rawBin = join(releaseDir, `diligent-desktop${plat.ext}`);
  if (existsSync(rawBin)) {
    copyArtifact(rawBin, platDir, `${projectArtifactName}-desktop-${version}-${plat.id}${plat.ext}`, list);
  }

  for (const bundleType of plat.desktopBundleTypes) {
    if (bundleType === "app") {
      const src = join(bundleDir, "macos", `${projectName}.app`);
      if (existsSync(src)) copyArtifact(src, platDir, `${projectName}-${version}.app`, list);
    } else if (bundleType === "AppImage") {
      const src = findFirst(join(bundleDir, "appimage"), ".AppImage");
      if (src) copyArtifact(src, platDir, `${projectArtifactName}-desktop-${version}-${plat.id}.AppImage`, list);
    } else if (bundleType === "deb") {
      const src = findFirst(join(bundleDir, "deb"), ".deb");
      if (src) copyArtifact(src, platDir, `${projectArtifactName}-desktop-${version}-${plat.id}.deb`, list);
    } else if (bundleType === "dmg") {
      const src = findFirst(join(bundleDir, "dmg"), ".dmg");
      if (src) copyArtifact(src, platDir, `${projectArtifactName}-desktop-${version}-${plat.id}.dmg`, list);
    } else if (bundleType === "nsis") {
      const src = findFirst(join(bundleDir, "nsis"), "-setup.exe");
      if (src) copyArtifact(src, platDir, `${projectArtifactName}-desktop-${version}-${plat.id}-setup.exe`, list);
    }
  }
}

// ---------------------------------------------------------------------------
// Size formatting
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fileSize(p: string): number {
  try {
    const s = statSync(p);
    return s.isDirectory() ? 0 : s.size;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Release metadata
// ---------------------------------------------------------------------------

interface ReleaseMeta {
  version: string;
  buildDate: string;
  gitCommit: string;
  platforms: string[];
  artifacts: Record<string, string[]>;
}

function getGitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8", cwd: ROOT }).trim();
  } catch {
    return "unknown";
  }
}

function writeReleaseMeta(distDir: string, plats: PlatformTarget[], artifacts: Record<string, string[]>): void {
  const meta: ReleaseMeta = {
    version,
    buildDate: new Date().toISOString(),
    gitCommit: getGitCommit(),
    platforms: plats.map((p) => p.id),
    artifacts,
  };
  writeFileSync(join(distDir, "release-meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

console.log(`\n📦 Packaging ${projectName} v${version} (desktop)`);
console.log(`   Platforms : ${platforms.map((p) => p.id).join(", ")}`);
console.log(`   App name  : ${projectName}`);
if (extraPackageDir) {
  console.log(`   Package   : ${extraPackageDir}`);
}
if (desktopIconPaths) {
  console.log(`   Icons     : ${desktopIconPaths.length} custom icon(s)`);
}
const tauriVer = toTauriVersion(version);
if (tauriVer !== version) {
  console.log(`   Tauri version: ${tauriVer} (pre-release stripped for MSI/NSIS compatibility)`);
}
console.log();

// Clean dist/ — Windows may lock directories/files (e.g. Explorer, antivirus).
// Recursively skip EBUSY/EPERM entries rather than aborting the whole clean.
function cleanDir(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    try {
      rmSync(full, { recursive: true, force: true });
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EBUSY" || code === "EPERM") {
        console.warn(`⚠️  Skipping locked file during clean: ${full}`);
      } else {
        throw e;
      }
    }
  }
}
cleanDir(DIST);
mkdirSync(DIST, { recursive: true });

const allArtifacts: Record<string, string[]> = {};
let backup: VersionBackup | undefined;

try {
  cleanupDesktopIconOverrides();
  const desktopIcons = applyDesktopIconOverrides(desktopIconPaths);

  // Inject version into protocol + tauri.conf.json
  console.log(`⚙️  Injecting version ${version}...`);
  backup = injectVersion(version, { projectName, desktopIcons });

  // Build web frontend once (embedded in desktop)
  console.log("\n🌐 Building web frontend...");
  buildWebFrontend();

  // Build desktop per platform
  for (const plat of platforms) {
    allArtifacts[plat.id] = [];
    const platDir = join(DIST, plat.id);
    mkdirSync(platDir, { recursive: true });

    if (plat.os !== currentOs()) {
      console.log(`\n⚠️  Skipping ${plat.id} — Tauri requires native build (current OS: ${currentOs()})`);
      continue;
    }

    // Assemble defaults/ resources (config template + bundled plugins)
    console.log(`\n📦 Assembling defaults...`);
    assembleDefaults(extraPackageDir);

    console.log(`\n🖥️  Building desktop: ${plat.id}`);
    buildDesktop(plat);
    collectDesktopArtifacts(plat, platDir, allArtifacts[plat.id]);
  }

  // Release metadata + checksums
  console.log("\n📝 Writing release-meta.json...");
  writeReleaseMeta(DIST, platforms, allArtifacts);

  console.log("🔐 Generating checksums.sha256...");
  generateChecksums(DIST);
} finally {
  // Always restore original files even on failure
  if (backup) {
    console.log("♻️  Restoring version files...");
    restoreVersion(backup);
  }
  cleanupDesktopIconOverrides();
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n✓ Packaging complete: ${projectName} v${version}\n`);
for (const plat of platforms) {
  const names = allArtifacts[plat.id] ?? [];
  if (names.length === 0) continue;
  console.log(`  ${plat.id}/`);
  for (const name of names) {
    const size = fileSize(join(DIST, plat.id, name));
    const sizeStr = size > 0 ? `  ${formatSize(size)}` : "";
    console.log(`    ${name.padEnd(55)}${sizeStr}`);
  }
}
console.log(`\n  checksums.sha256`);
console.log(`  release-meta.json\n`);
