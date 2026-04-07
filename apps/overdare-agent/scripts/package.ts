// @summary Desktop packaging orchestrator — builds Tauri desktop app and assembles dist/

import { execSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { prepareBootstrapResources } from "./lib/bootstrap";
import { generateChecksums } from "./lib/checksum";
import { generateUpdateManifest } from "./lib/manifest";
import { shouldBuildDesktopBinary } from "./lib/package-mode";
import { ALL_PLATFORMS, filterPlatforms, type PlatformTarget } from "./lib/platforms";
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
    "skip-desktop-binary": { type: "boolean", default: false },
  },
});

if (!values.version) {
  console.error("Usage: bun run scripts/package.ts --version <semver> [--platforms p1,p2] [--skip-desktop-binary]");
  process.exit(1);
}

const version = values.version;
const platformIds = values.platforms!.split(",").map((s) => s.trim());
const platforms = filterPlatforms(platformIds);
const skipDesktopBinary = values["skip-desktop-binary"] === true;
const projectName = resolveProjectName();
const projectArtifactName = toProjectArtifactName(projectName);
const desktopIconPaths = resolveDesktopIconPaths();

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

function run(cmd: string | string[], cwd: string = ROOT, env?: NodeJS.ProcessEnv): void {
  const mergedEnv = { ...process.env, ...env };
  if (Array.isArray(cmd)) {
    const [file, ...args] = cmd;
    const result = spawnSync(file, args, { cwd, stdio: "inherit", env: mergedEnv });
    if (result.status !== 0) {
      throw new Error(`Command failed: ${cmd.join(" ")}`);
    }
    return;
  }

  execSync(cmd, { cwd, stdio: "inherit", env: mergedEnv });
}

function buildWebFrontend(): void {
  run("bun run build", join(ROOT, "packages/web"), {
    VITE_APP_PROJECT_NAME: projectName,
  });
}

// ---------------------------------------------------------------------------
// Bootstrap assembly — bundled plugin(s) + app bootstrap content → resources/bootstrap/
// ---------------------------------------------------------------------------

const BOOTSTRAP_RESOURCES = join(DESKTOP, "src-tauri/resources/bootstrap");

function assembleBootstrap(): void {
  prepareBootstrapResources({
    rootDir: ROOT,
    desktopDir: DESKTOP,
    run,
  });
}

function buildSidecar(plat: PlatformTarget): void {
  // Skip build:sidecar script (which re-runs prepareBootstrapResources and
  // wipes the already-assembled bootstrap). Instead compile the sidecar binary
  // directly — assembleBootstrap has already populated resources/bootstrap/.
  const serverEntry = join(ROOT, "packages/web/src/server/index.ts");
  const outPath = join(DESKTOP, `src-tauri/binaries/diligent-web-server-${plat.tauriTriple}${plat.ext}`);
  run(`bun build --compile --target=${plat.bunTarget} ${serverEntry} --outfile ${outPath}`, ROOT);
}

function buildDesktop(plat: PlatformTarget, options?: { skipDesktopBinary?: boolean }): void {
  const tauriDir = join(DESKTOP, "src-tauri");
  const updateUrlEnv = process.env.DILIGENT_UPDATE_URL ?? "";
  const buildFingerprint = `runtimeVersion=${version};updateUrl=${updateUrlEnv}`;

  // Copy web frontend into Tauri resource tree
  const clientDist = join(ROOT, "packages/web/dist/client");
  const resourceDist = join(tauriDir, "resources/dist/client");
  cpSync(clientDist, resourceDist, { recursive: true });

  buildSidecar(plat);

  if (options?.skipDesktopBinary === true) {
    console.log("   Skip-desktop-binary mode enabled — skipping Tauri desktop binary build");
    return;
  }

  const tauriConfigPath = join(tauriDir, ".diligent-packaging", "tauri.package.conf.json");

  if (rustSourcesChanged(tauriDir, { buildFingerprint })) {
    console.log("   Rust sources changed — full compile");
    run(`bunx tauri build --no-bundle --config "${tauriConfigPath}"`, DESKTOP, {
      TAURI_TARGET_TRIPLE: plat.tauriTriple,
      DILIGENT_APP_PROJECT_NAME: projectName,
      DILIGENT_RUNTIME_VERSION: version,
      ...(updateUrlEnv ? { DILIGENT_UPDATE_URL: updateUrlEnv } : {}),
    });
    saveRustHash(tauriDir, { buildFingerprint });
  } else {
    console.log("   Rust sources unchanged — skipping compile (portable folder assembled directly)");
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

/**
 * Copy the Tauri desktop exe to dist/ with a release-friendly name.
 * The exe is the thin Tauri shell — runtime components are in the runtime bundle.
 */
function collectDesktopExe(plat: PlatformTarget): string | undefined {
  const releaseDir = join(DESKTOP, "src-tauri/target/release");
  const mainBin = join(releaseDir, `overdare-agent-desktop${plat.ext}`);
  if (!existsSync(mainBin)) return undefined;

  const exeName = `${projectArtifactName}-${version}-${plat.id}${plat.ext}`;
  cpSync(mainBin, join(DIST, exeName));
  console.log(`   Collected: ${exeName}`);
  return exeName;
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
// Runtime bundle — sidecar + web client + plugins + bootstrap for auto-update
// ---------------------------------------------------------------------------

function assembleRuntimeBundle(plat: PlatformTarget): string | undefined {
  const tauriDir = join(DESKTOP, "src-tauri");
  const runtimeDir = join(DIST, `runtime-${plat.id}`);

  // Clean and create temp assembly dir
  if (existsSync(runtimeDir)) {
    rmSync(runtimeDir, { recursive: true, force: true });
  }
  mkdirSync(runtimeDir, { recursive: true });

  // 1. Copy sidecar binary
  const sidecarName = `diligent-web-server-${plat.tauriTriple}${plat.ext}`;
  const sidecarSrc = join(tauriDir, "binaries", sidecarName);
  if (!existsSync(sidecarSrc)) return undefined;
  cpSync(sidecarSrc, join(runtimeDir, `diligent-web-server${plat.ext}`));

  // 2. Copy rg binary (if bundled)
  const rgName = `rg-${plat.tauriTriple}${plat.ext}`;
  const rgSrc = join(tauriDir, "binaries", rgName);
  if (existsSync(rgSrc)) {
    cpSync(rgSrc, join(runtimeDir, `rg${plat.ext}`));
  }

  // 3. Copy dist/client (React SPA)
  const clientSrc = join(tauriDir, "resources/dist/client");
  if (existsSync(clientSrc)) {
    cpSync(clientSrc, join(runtimeDir, "dist/client"), { recursive: true });
  }

  // 4. Copy bootstrap content into the legacy runtime `defaults/` path for now.
  if (existsSync(BOOTSTRAP_RESOURCES)) {
    cpSync(BOOTSTRAP_RESOURCES, join(runtimeDir, "defaults"), { recursive: true });
  }

  // 5. Zip
  const zipName = `${projectArtifactName}-runtime-${version}-${plat.id}.zip`;
  const zipPath = join(DIST, zipName);
  if (process.platform === "win32") {
    run(`powershell -Command "Compress-Archive -Path '${runtimeDir}\\*' -DestinationPath '${zipPath}' -Force"`, ROOT);
  } else {
    run(`zip -r "${zipPath}" .`, runtimeDir);
  }

  // Clean up temp dir
  rmSync(runtimeDir, { recursive: true, force: true });

  return zipName;
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
console.log(`   Mode      : ${skipDesktopBinary ? "skip-desktop-binary" : "full"}`);
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
      if (code === "EBUSY" || code === "EPERM" || code === "EACCES") {
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

  // Inject version into protocol + temporary Tauri config
  console.log(`⚙️  Injecting version ${version}...`);
  backup = injectVersion(version, { projectName, desktopIcons });

  // Build web frontend once (embedded in desktop)
  console.log("\n🌐 Building web frontend...");
  buildWebFrontend();

  // Build desktop per platform
  for (const plat of platforms) {
    allArtifacts[plat.id] = [];

    if (plat.os !== currentOs()) {
      console.log(`\n⚠️  Skipping ${plat.id} — Tauri requires native build (current OS: ${currentOs()})`);
      continue;
    }

    // Assemble bootstrap/ resources (config template + bundled plugins)
    console.log(`\n📦 Assembling bootstrap...`);
    assembleBootstrap();

    console.log(`\n🖥️  Building desktop: ${plat.id}`);
    buildDesktop(plat, { skipDesktopBinary });
  }

  if (shouldBuildDesktopBinary(skipDesktopBinary)) {
    // Collect desktop exe(s)
    console.log("\n📋 Collecting desktop exe...");
    for (const plat of platforms) {
      if (plat.os !== currentOs()) continue;
      const exeName = collectDesktopExe(plat);
      if (exeName) {
        allArtifacts[plat.id].push(exeName);
      }
    }
  }

  // Assemble runtime bundles
  console.log("\n📦 Assembling runtime bundles...");
  for (const plat of platforms) {
    if (plat.os !== currentOs()) continue;
    const bundleName = assembleRuntimeBundle(plat);
    if (bundleName) {
      allArtifacts[plat.id].push(bundleName);
      console.log(`   Created: ${bundleName}`);
    }
  }

  // Generate update manifest
  console.log("\n📝 Writing update-manifest.json...");
  const updateBaseUrl =
    process.env.DILIGENT_UPDATE_BASE_URL || `https://github.com/overdare/diligent/releases/download/v${version}`;
  generateUpdateManifest({
    version,
    distDir: DIST,
    platforms,
    baseUrl: updateBaseUrl,
    projectArtifactName,
  });

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
  console.log(`  ${plat.id}:`);
  for (const name of names) {
    const size = fileSize(join(DIST, name));
    const sizeStr = size > 0 ? `  ${formatSize(size)}` : "";
    console.log(`    ${name.padEnd(55)}${sizeStr}`);
  }
}
console.log(`\n  checksums.sha256`);
console.log(`  release-meta.json`);
console.log(`  update-manifest.json\n`);
