// @summary Build a fresh standalone diligent-web-server binary for local overdare-ai-agent diagnostics.

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const WEB = resolve(ROOT, "packages/web");
const OUT_DIR = resolve(ROOT, "apps/overdare-ai-agent/.diligent/diagnostics");

const TARGET_BY_PLATFORM = new Map<string, string>([
  ["darwin-arm64", "bun-darwin-arm64"],
  ["darwin-x64", "bun-darwin-x64"],
  ["linux-x64", "bun-linux-x64"],
  ["windows-x64", "bun-windows-x64"],
]);

function currentPlatformKey(): string {
  if (process.platform === "win32") {
    return `windows-${process.arch}`;
  }
  return `${process.platform}-${process.arch}`;
}

async function run(): Promise<void> {
  const platformKey = currentPlatformKey();
  const bunTarget = TARGET_BY_PLATFORM.get(platformKey);
  if (!bunTarget) {
    throw new Error(`Unsupported platform for sidecar diagnostics build: ${platformKey}`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const outPath = resolve(OUT_DIR, process.platform === "win32" ? "diligent-web-server.exe" : "diligent-web-server");
  const serverEntry = resolve(WEB, "src/server/index.ts");

  const result = Bun.spawnSync(
    ["bun", "build", "--compile", `--target=${bunTarget}`, serverEntry, "--outfile", outPath],
    {
      cwd: ROOT,
      stdio: ["inherit", "inherit", "inherit"],
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(`Fresh sidecar build failed for ${platformKey}`);
  }

  console.log(outPath);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
