// @summary Build script: compiles Bun web server sidecar and copies dist/client for Tauri packaging
import { existsSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { prepareDefaultsResources } from "./lib/defaults";

const ROOT = resolve(import.meta.dir, "../../..");
const WEB = resolve(ROOT, "packages/web");
const DESKTOP = resolve(ROOT, "apps/desktop");
const BINARIES = resolve(DESKTOP, "src-tauri/binaries");
const RESOURCES = resolve(DESKTOP, "src-tauri/resources");

type TargetPlatform = {
  bunTarget: string;
  tauriTriple: string;
  ext: string;
};

const PLATFORMS: TargetPlatform[] = [
  { bunTarget: "bun-darwin-arm64", tauriTriple: "aarch64-apple-darwin", ext: "" },
  { bunTarget: "bun-darwin-x64", tauriTriple: "x86_64-apple-darwin", ext: "" },
  { bunTarget: "bun-linux-x64", tauriTriple: "x86_64-unknown-linux-gnu", ext: "" },
  { bunTarget: "bun-windows-x64", tauriTriple: "x86_64-pc-windows-msvc", ext: ".exe" },
];

async function run(): Promise<void> {
  const singleTarget = process.env.TAURI_TARGET_TRIPLE?.trim();

  prepareDefaultsResources({
    rootDir: ROOT,
    desktopDir: DESKTOP,
    run(command, cwd) {
      const result = Bun.spawnSync(command.split(" "), { cwd, stdio: ["inherit", "inherit", "inherit"] });
      if (result.exitCode !== 0) {
        throw new Error(`Defaults preparation command failed: ${command}`);
      }
    },
  });

  // Step 1: Build React SPA if not already built
  const clientDist = resolve(WEB, "dist/client");
  if (!existsSync(clientDist)) {
    console.log("Building React SPA...");
    const buildResult = Bun.spawnSync(["bun", "run", "build"], { cwd: WEB, stdio: ["inherit", "inherit", "inherit"] });
    if (buildResult.exitCode !== 0) {
      throw new Error("Frontend build failed");
    }
  }

  // Step 2: Compile sidecar binary for each target
  const serverEntry = resolve(WEB, "src/server/index.ts");
  const targets = singleTarget ? PLATFORMS.filter((p) => p.tauriTriple === singleTarget) : PLATFORMS;

  if (targets.length === 0) {
    throw new Error(`No platform config found for TAURI_TARGET_TRIPLE=${singleTarget}`);
  }

  for (const { bunTarget, tauriTriple, ext } of targets) {
    const outName = `diligent-web-server-${tauriTriple}${ext}`;
    const outPath = resolve(BINARIES, outName);

    console.log(`Compiling sidecar for ${tauriTriple}...`);
    const result = Bun.spawnSync(
      ["bun", "build", "--compile", `--target=${bunTarget}`, serverEntry, "--outfile", outPath],
      { cwd: ROOT, stdio: ["inherit", "inherit", "inherit"] },
    );
    if (result.exitCode !== 0) {
      throw new Error(`Sidecar build failed for ${tauriTriple}`);
    }
    console.log(`  -> ${outPath}`);
  }

  // Step 3: Copy dist/client into src-tauri/resources/dist/client
  const resourcesDist = resolve(RESOURCES, "dist/client");
  await mkdir(resourcesDist, { recursive: true });
  await cp(clientDist, resourcesDist, { recursive: true });
  console.log(`Copied dist/client -> ${resourcesDist}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
