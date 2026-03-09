// @summary Desktop packaging orchestrator — builds Tauri desktop app and assembles dist/

import { parseArgs } from "node:util";
import {
  mkdirSync,
  rmSync,
  cpSync,
  existsSync,
  writeFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { ALL_PLATFORMS, filterPlatforms, type PlatformTarget } from "./lib/platforms";
import { injectVersion, restoreVersion, toTauriVersion, type VersionBackup } from "./lib/version";
import { generateChecksums } from "./lib/checksum";

const ROOT = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");

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
  },
});

if (!values.version) {
  console.error(
    "Usage: bun run scripts/package.ts --version <semver> [--platforms p1,p2]",
  );
  process.exit(1);
}

const version = values.version;
const platformIds = values.platforms!.split(",").map((s) => s.trim());
const platforms = filterPlatforms(platformIds);

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
  run("bun run build", join(ROOT, "packages/web"));
}

// ---------------------------------------------------------------------------
// Defaults assembly — bundled plugin(s) + default config → resources/defaults/
// ---------------------------------------------------------------------------

const DEFAULTS_SRC = join(ROOT, "apps/desktop/defaults");
const DEFAULTS_RESOURCES = join(ROOT, "apps/desktop/src-tauri/resources/defaults");

/**
 * Bundle a plugin directory to a single ESM file using `bun build`.
 * Output: resources/defaults/plugins/<pluginName>/index.js + package.json
 */
function bundlePlugin(pluginDir: string, pluginName: string): void {
  const pluginEntry = join(pluginDir, "src/index.ts");
  const outDir = join(DEFAULTS_RESOURCES, "plugins", pluginName);
  mkdirSync(outDir, { recursive: true });

  const outFile = join(outDir, "index.js");
  run(`bun build --target bun --outfile ${outFile} ${pluginEntry}`);

  // Write minimal package.json so import(dirUrl) resolves to index.js
  const pkgJson = {
    name: pluginName,
    version: "0.1.0",
    type: "module",
    main: "index.js",
  };
  writeFileSync(join(outDir, "package.json"), JSON.stringify(pkgJson, null, 2) + "\n");
  console.log(`   Bundled plugin: ${pluginName} → ${outFile}`);
}

function assembleDefaults(): void {
  // Clean and recreate defaults resources dir
  if (existsSync(DEFAULTS_RESOURCES)) {
    rmSync(DEFAULTS_RESOURCES, { recursive: true, force: true });
  }
  mkdirSync(DEFAULTS_RESOURCES, { recursive: true });

  // Copy default config template
  const configSrc = join(DEFAULTS_SRC, "config.jsonc");
  if (existsSync(configSrc)) {
    cpSync(configSrc, join(DEFAULTS_RESOURCES, "config.jsonc"));
    console.log("   Copied config.jsonc template");
  }

  // Bundle plugins
  const urlFetchPlugin = join(ROOT, "thirdparty/examples/url-fetch-workspace/plugin");
  if (existsSync(urlFetchPlugin)) {
    bundlePlugin(urlFetchPlugin, "url-fetch-plugin");
  }
}

function buildDesktop(plat: PlatformTarget): void {
  // Copy web frontend into Tauri resource tree
  const clientDist = join(ROOT, "packages/web/dist/client");
  const resourceDist = join(ROOT, "apps/desktop/src-tauri/resources/dist/client");
  cpSync(clientDist, resourceDist, { recursive: true });

  // Build web server sidecar for this platform
  run("bun run build:sidecar", join(ROOT, "apps/desktop"), {
    TAURI_TARGET_TRIPLE: plat.tauriTriple,
  });

  // Build Tauri desktop app
  run("bunx tauri build", join(ROOT, "apps/desktop"), {
    TAURI_TARGET_TRIPLE: plat.tauriTriple,
  });
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

function collectDesktopArtifacts(
  plat: PlatformTarget,
  platDir: string,
  list: string[],
): void {
  const bundleDir = join(ROOT, "apps/desktop/src-tauri/target/release/bundle");
  const releaseDir = join(ROOT, "apps/desktop/src-tauri/target/release");

  // Raw binary
  const rawBin = join(releaseDir, `diligent-desktop${plat.ext}`);
  if (existsSync(rawBin)) {
    copyArtifact(rawBin, platDir, `diligent-desktop-${version}-${plat.id}${plat.ext}`, list);
  }

  for (const bundleType of plat.desktopBundleTypes) {
    if (bundleType === "app") {
      const src = join(bundleDir, "macos/Diligent.app");
      if (existsSync(src)) copyArtifact(src, platDir, `Diligent-${version}.app`, list);
    } else if (bundleType === "AppImage") {
      const src = findFirst(join(bundleDir, "appimage"), ".AppImage");
      if (src) copyArtifact(src, platDir, `diligent-desktop-${version}-${plat.id}.AppImage`, list);
    } else if (bundleType === "deb") {
      const src = findFirst(join(bundleDir, "deb"), ".deb");
      if (src) copyArtifact(src, platDir, `diligent-desktop-${version}-${plat.id}.deb`, list);
    } else if (bundleType === "msi") {
      const src = findFirst(join(bundleDir, "msi"), ".msi");
      if (src) copyArtifact(src, platDir, `diligent-desktop-${version}-${plat.id}.msi`, list);
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

function writeReleaseMeta(
  distDir: string,
  plats: PlatformTarget[],
  artifacts: Record<string, string[]>,
): void {
  const meta: ReleaseMeta = {
    version,
    buildDate: new Date().toISOString(),
    gitCommit: getGitCommit(),
    platforms: plats.map((p) => p.id),
    artifacts,
  };
  writeFileSync(join(distDir, "release-meta.json"), JSON.stringify(meta, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

console.log(`\n📦 Packaging Diligent v${version} (desktop)`);
console.log(`   Platforms : ${platforms.map((p) => p.id).join(", ")}`);
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
  // Inject version into protocol + tauri.conf.json
  console.log(`⚙️  Injecting version ${version}...`);
  backup = injectVersion(version);

  // Build web frontend once (embedded in desktop)
  console.log("\n🌐 Building web frontend...");
  buildWebFrontend();

  // Build desktop per platform
  for (const plat of platforms) {
    allArtifacts[plat.id] = [];
    const platDir = join(DIST, plat.id);
    mkdirSync(platDir, { recursive: true });

    if (plat.os !== currentOs()) {
      console.log(
        `\n⚠️  Skipping ${plat.id} — Tauri requires native build (current OS: ${currentOs()})`,
      );
      continue;
    }

    // Assemble defaults/ resources (config template + bundled plugins)
    console.log(`\n📦 Assembling defaults...`);
    assembleDefaults();

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
  // Always restore version files even on failure
  if (backup) {
    console.log("\n♻️  Restoring version files...");
    restoreVersion(backup);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n✓ Packaging complete: Diligent v${version}\n`);
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
