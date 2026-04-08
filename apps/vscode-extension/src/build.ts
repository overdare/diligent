// @summary Build script bundling the extension host and webview assets into dist/
import * as fs from "node:fs/promises";
import * as path from "node:path";

const rootDir = path.resolve(import.meta.dir, "..");
const distDir = path.join(rootDir, "dist");
const webviewDir = path.join(distDir, "webview");

await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(webviewDir, { recursive: true });

await Bun.build({
  entrypoints: [path.join(rootDir, "src", "extension.ts")],
  outdir: distDir,
  target: "node",
  format: "esm",
  sourcemap: "linked",
  external: ["vscode"],
});

await Bun.build({
  entrypoints: [path.join(rootDir, "src", "views", "webview", "index.ts")],
  outdir: webviewDir,
  target: "browser",
  format: "iife",
  sourcemap: "linked",
  minify: false,
});

await fs.copyFile(path.join(rootDir, "src", "views", "webview", "styles.css"), path.join(webviewDir, "styles.css"));
await fs.copyFile(path.join(rootDir, "media", "diligent.svg"), path.join(distDir, "diligent.svg"));
