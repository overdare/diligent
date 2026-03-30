// @summary Build desktop.exe only (thin shell) without assembling runtime bundles

import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateChecksums } from "./lib/checksum";
import { filterPlatforms } from "./lib/platforms";
import { resolveProjectName, toProjectArtifactName } from "./lib/project-name";
import { rustSourcesChanged, saveRustHash } from "./lib/rust-cache";
import { injectVersion, restoreVersion, type VersionBackup } from "./lib/version";

const ROOT = join(import.meta.dir, "../../..");
const DESKTOP = join(import.meta.dir, "..");
const DIST = join(ROOT, "dist");
const PLATFORM_ID = "windows-x64";

const VERSION = process.argv[2];
if (!VERSION) {
  console.error("Usage: bun run apps/desktop/scripts/build-exe-only.ts <semver>");
  process.exit(1);
}

const WINDOWS_PLATFORM = filterPlatforms([PLATFORM_ID])[0];

function run(cmd: string, cwd: string = ROOT, env?: NodeJS.ProcessEnv): void {
  execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, ...env } });
}

function ensureDist(): void {
  if (!existsSync(DIST)) {
    mkdirSync(DIST, { recursive: true });
  }
}

function buildWebFrontend(projectName: string): void {
  run("bun run build", join(ROOT, "packages/web"), {
    VITE_APP_PROJECT_NAME: projectName,
  });
}

function buildSidecar(): void {
  const serverEntry = join(ROOT, "packages/web/src/server/index.ts");
  const outPath = join(
    DESKTOP,
    `src-tauri/binaries/diligent-web-server-${WINDOWS_PLATFORM.tauriTriple}${WINDOWS_PLATFORM.ext}`,
  );
  run(`bun build --compile --target=${WINDOWS_PLATFORM.bunTarget} ${serverEntry} --outfile ${outPath}`, ROOT);
}

function copyFrontendToResources(): void {
  const tauriDir = join(DESKTOP, "src-tauri");
  const clientDist = join(ROOT, "packages/web/dist/client");
  const resourceDist = join(tauriDir, "resources/dist/client");
  cpSync(clientDist, resourceDist, { recursive: true });
}

function collectDesktopExe(projectArtifactName: string): string {
  const rootReleaseDir = join(DESKTOP, "src-tauri", "target", "release");
  const tripleReleaseDir = join(DESKTOP, "src-tauri", "target", WINDOWS_PLATFORM.tauriTriple, "release");

  const candidatePaths = [join(rootReleaseDir, "diligent-desktop.exe"), join(tripleReleaseDir, "diligent-desktop.exe")];

  const sourceExe = candidatePaths.find((path) => existsSync(path));
  if (!sourceExe) {
    throw new Error(`Missing built exe. Checked: ${candidatePaths.join(", ")}`);
  }

  const outputName = `${projectArtifactName}-${VERSION}-${PLATFORM_ID}.exe`;
  cpSync(sourceExe, join(DIST, outputName));
  return outputName;
}

function runTauriBuild(projectName: string): void {
  const tauriDir = join(DESKTOP, "src-tauri");
  const tauriConfigPath = join(tauriDir, ".diligent-packaging", "tauri.package.conf.json");
  const updateUrlEnv = process.env.DILIGENT_UPDATE_URL ?? "";
  const buildFingerprint = `runtimeVersion=${VERSION};updateUrl=${updateUrlEnv}`;

  if (rustSourcesChanged(tauriDir, { buildFingerprint })) {
    run(`bunx tauri build --no-bundle --config "${tauriConfigPath}"`, DESKTOP, {
      TAURI_TARGET_TRIPLE: WINDOWS_PLATFORM.tauriTriple,
      DILIGENT_APP_PROJECT_NAME: projectName,
      DILIGENT_RUNTIME_VERSION: VERSION,
      ...(updateUrlEnv ? { DILIGENT_UPDATE_URL: updateUrlEnv } : {}),
    });
    saveRustHash(tauriDir, { buildFingerprint });
  } else {
    console.log("   Rust sources unchanged — skipping compile");
  }
}

function writeReleaseMeta(exeName: string): void {
  const releaseMetaPath = join(DIST, "release-meta-exe-only.json");
  const payload = {
    version: VERSION,
    platforms: {
      [PLATFORM_ID]: [exeName],
    },
    mode: "exe-only",
  };
  writeFileSync(releaseMetaPath, `${JSON.stringify(payload, null, 2)}\n`);
}

let backup: VersionBackup | undefined;
let builtExeName = "";

try {
  ensureDist();

  const projectName = resolveProjectName(undefined);
  const projectArtifactName = toProjectArtifactName(projectName);

  console.log(`\n🧪 Building desktop exe-only: v${VERSION} (${PLATFORM_ID})`);

  backup = injectVersion(VERSION, { projectName });
  buildWebFrontend(projectName);
  buildSidecar();
  copyFrontendToResources();
  runTauriBuild(projectName);
  builtExeName = collectDesktopExe(projectArtifactName);
  writeReleaseMeta(builtExeName);
  generateChecksums(DIST);

  console.log(`\n✓ exe-only build complete: ${builtExeName}`);
} finally {
  if (backup) {
    restoreVersion(backup);
  }

  const tempConfigPath = join(DESKTOP, "src-tauri", ".diligent-packaging", "tauri.package.conf.json");
  rmSync(tempConfigPath, { force: true });
}
