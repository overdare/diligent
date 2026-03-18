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

const runScript = `@echo off\r\nsetlocal\r\nset SCRIPT_DIR=%~dp0\r\nif "%~1"=="" (\r\n  "%SCRIPT_DIR%debug-viewer.exe" --data-dir "%SCRIPT_DIR%.diligent"\r\n) else (\r\n  "%SCRIPT_DIR%debug-viewer.exe" --data-dir "%~1"\r\n)\r\n`;
writeFileSync(join(outputDir, "run-debug-viewer.bat"), runScript, "utf8");

const readme = `Debug Viewer (Windows internal build)\n\n1) Place this folder where you want to run it.\n2) Put your .diligent folder in the same directory as debug-viewer.exe\n   OR pass a data dir path to run-debug-viewer.bat.\n\nUsage:\n- Double-click run-debug-viewer.bat\n- Or run: run-debug-viewer.bat C:\\path\\to\\.diligent\n\nThen open: http://localhost:7432\n`;
writeFileSync(join(outputDir, "README.txt"), readme, "utf8");

console.log("[debug-viewer] Windows bundle ready:");
console.log(`  ${outputDir}`);
