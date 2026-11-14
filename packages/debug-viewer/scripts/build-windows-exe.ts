// @summary Build Windows exe bundle for debug-viewer without requiring Bun on user machines
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join, resolve } from "path";

const packageRoot = resolve(import.meta.dir, "..");
const repoRoot = resolve(packageRoot, "../..");
const outputDir = resolve(repoRoot, "dist/debug-viewer-windows");
const exePath = join(outputDir, "debug-viewer.exe");
const clientDistDir = resolve(packageRoot, "dist/client");
const outputClientDir = join(outputDir, "client");

console.log("[debug-viewer] Building client bundle...");
const buildClient = Bun.spawn(["bunx", "vite", "build"], {
  cwd: packageRoot,
  stdout: "inherit",
  stderr: "inherit",
});
if ((await buildClient.exited) !== 0) {
  console.error("[debug-viewer] Client build failed.");
  process.exit(1);
}

console.log("[debug-viewer] Building windows exe...");
const buildExe = Bun.spawn(
  ["bun", "build", "--compile", "--target=bun-windows-x64", "src/server/index.ts", "--outfile", exePath],
  {
    cwd: packageRoot,
    stdout: "inherit",
    stderr: "inherit",
  },
);
if ((await buildExe.exited) !== 0) {
  console.error("[debug-viewer] Exe build failed.");
  process.exit(1);
}

if (!existsSync(clientDistDir)) {
  console.error("[debug-viewer] Client dist directory missing after build.");
  process.exit(1);
}

rmSync(outputClientDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
cpSync(clientDistDir, outputClientDir, { recursive: true });

const readme = `Debug Viewer (Windows internal build)\n\nUsage:\n- debug-viewer.exe --dir C:\\path\\to\\project-root\n\nNotes:\n- --dir accepts project root (if it contains .diligent, it will be detected automatically).\n- If --dir is omitted, it searches from current working directory first.\n- If not found, it falls back to <exe folder>/.diligent.\n\nThen open: http://localhost:7432\n`;
writeFileSync(join(outputDir, "README.txt"), readme, "utf8");

console.log("[debug-viewer] Windows bundle ready:");
console.log(`  ${outputDir}`);
