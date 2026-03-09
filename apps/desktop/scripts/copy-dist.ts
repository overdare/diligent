// @summary Post-build script: copies Tauri bundle output into the repo-root dist/ folder

import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const DESKTOP = resolve(import.meta.dir, "..");
const DIST = resolve(DESKTOP, "../../dist");

type CopyEntry = {
  src: string;
  dest: string;
};

function getSidecarTriple(): string {
  if (process.platform === "darwin") return "aarch64-apple-darwin";
  if (process.platform === "win32") return "x86_64-pc-windows-msvc";
  return "x86_64-unknown-linux-gnu";
}

function getEntries(): CopyEntry[] {
  const releaseDir = join(DESKTOP, "src-tauri/target/release");
  const bundleDir = join(releaseDir, "bundle");
  const entries: CopyEntry[] = [];

  // Raw binary
  const binaryName = process.platform === "win32" ? "diligent-desktop.exe" : "diligent-desktop";
  const binarySuffix =
    process.platform === "darwin" ? "-darwin-arm64" : process.platform === "win32" ? "-windows-x64" : "-linux-x64";
  entries.push({
    src: join(releaseDir, binaryName),
    dest: join(DIST, `diligent-desktop${binarySuffix}${process.platform === "win32" ? ".exe" : ""}`),
  });

  // Portable bundle: sidecar + dist/client next to the raw exe so it runs without installation
  // Tauri runtime resolves sidecar by name without triple (e.g. diligent-web-server.exe)
  const triple = getSidecarTriple();
  const sidecarExt = process.platform === "win32" ? ".exe" : "";
  const sidecarSrc = join(DESKTOP, `src-tauri/binaries/diligent-web-server-${triple}${sidecarExt}`);
  entries.push({ src: sidecarSrc, dest: join(DIST, `diligent-web-server-${triple}${sidecarExt}`) });
  entries.push({ src: sidecarSrc, dest: join(DIST, `diligent-web-server${sidecarExt}`) });
  entries.push({
    src: join(DESKTOP, "src-tauri/resources/dist/client"),
    dest: join(DIST, "dist/client"),
  });

  // Bundle
  switch (process.platform) {
    case "darwin":
      entries.push({ src: join(bundleDir, "macos/Diligent.app"), dest: join(DIST, "Diligent.app") });
      break;
    case "win32": {
      const msiDir = join(bundleDir, "msi");
      const msiFi = existsSync(msiDir)
        ? require("node:fs")
            .readdirSync(msiDir)
            .find((f: string) => f.endsWith(".msi"))
        : undefined;
      if (msiFi) entries.push({ src: join(msiDir, msiFi), dest: join(DIST, msiFi) });
      break;
    }
    default: {
      const appimageDir = join(bundleDir, "appimage");
      const debDir = join(bundleDir, "deb");
      for (const [dir, ext] of [
        [appimageDir, ".AppImage"],
        [debDir, ".deb"],
      ] as const) {
        if (!existsSync(dir)) continue;
        const fi = require("node:fs")
          .readdirSync(dir)
          .find((f: string) => f.endsWith(ext));
        if (fi) {
          entries.push({ src: join(dir, fi), dest: join(DIST, fi) });
          break;
        }
      }
    }
  }

  return entries;
}

async function run(): Promise<void> {
  const entries = getEntries();

  await mkdir(DIST, { recursive: true });

  for (const { src, dest } of entries) {
    if (!existsSync(src)) {
      console.warn(`Skipping (not found): ${src}`);
      continue;
    }
    if (existsSync(dest)) await rm(dest, { recursive: true, force: true });
    await cp(src, dest, { recursive: true });
    console.log(`Copied ${src} -> ${dest}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
