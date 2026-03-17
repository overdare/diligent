// @summary Version injection for packaging — patches protocol and Tauri config

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../../..");
const PROTOCOL_PATH = join(ROOT, "packages/protocol/src/methods.ts");
const TAURI_CONF_PATH = join(ROOT, "apps/desktop/src-tauri/tauri.conf.json");

export interface VersionBackup {
  protocolOriginal: string;
  tauriOriginal: string;
}

interface InjectVersionOptions {
  projectName?: string;
  desktopIcons?: string[];
}

/**
 * Strip pre-release and build metadata from a semver string, keeping only X.Y.Z.
 * MSI (and NSIS) bundle targets require a purely numeric version.
 *
 * e.g. "1.2.3-beta.1+build.5" → "1.2.3"
 */
export function toTauriVersion(version: string): string {
  return version.replace(/[-+].*$/, "");
}

export function injectVersion(version: string, options?: InjectVersionOptions): VersionBackup {
  const protocolOriginal = readFileSync(PROTOCOL_PATH, "utf-8");
  const tauriOriginal = readFileSync(TAURI_CONF_PATH, "utf-8");

  // Patch protocol version (full semver including pre-release)
  if (!/export const DILIGENT_VERSION = "[^"]+"/.test(protocolOriginal)) {
    throw new Error(`Could not find DILIGENT_VERSION in ${PROTOCOL_PATH}`);
  }
  const patchedProtocol = protocolOriginal.replace(
    /export const DILIGENT_VERSION = "[^"]+"/,
    `export const DILIGENT_VERSION = "${version}"`,
  );
  writeFileSync(PROTOCOL_PATH, patchedProtocol);

  // Patch Tauri version — MSI/NSIS only accept numeric X.Y.Z, strip pre-release
  const tauriConf = JSON.parse(tauriOriginal);
  tauriConf.version = toTauriVersion(version);
  const projectName = options?.projectName;
  if (projectName) {
    tauriConf.productName = projectName;
    if (Array.isArray(tauriConf.app?.windows)) {
      for (const window of tauriConf.app.windows) {
        if (window?.label === "main") {
          window.title = projectName;
        }
      }
    }
  }
  const desktopIcons = options?.desktopIcons;
  if (desktopIcons && desktopIcons.length > 0) {
    tauriConf.bundle ??= {};
    tauriConf.bundle.icon = desktopIcons;
  }
  writeFileSync(TAURI_CONF_PATH, `${JSON.stringify(tauriConf, null, 2)}\n`);

  return { protocolOriginal, tauriOriginal };
}

export function restoreVersion(backup: VersionBackup): void {
  writeFileSync(PROTOCOL_PATH, backup.protocolOriginal);
  writeFileSync(TAURI_CONF_PATH, backup.tauriOriginal);
}
