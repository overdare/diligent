// @summary Packaging version helpers — patches protocol and writes a temporary Tauri config

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../../..");
const PROTOCOL_PATH = join(ROOT, "packages/protocol/src/methods.ts");
const TAURI_CONF_PATH = join(ROOT, "apps/desktop/src-tauri/tauri.conf.json");
const TAURI_TEMP_CONFIG_DIR = join(ROOT, "apps/desktop/src-tauri/.diligent-packaging");
const TAURI_TEMP_CONFIG_PATH = join(TAURI_TEMP_CONFIG_DIR, "tauri.package.conf.json");

export interface VersionBackup {
  protocolOriginal: string;
  tauriTempConfigPath: string;
}

interface InjectVersionOptions {
  projectName?: string;
  desktopIcons?: string[];
}

interface TauriConfigWindow {
  label?: string;
  title?: string;
}

interface TauriConfig {
  version?: string;
  productName?: string;
  app?: {
    windows?: TauriConfigWindow[];
  };
  bundle?: {
    icon?: string[];
  };
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

export function patchProtocolVersionContent(protocolSource: string, version: string): string {
  if (!/export const DILIGENT_VERSION = "[^"]+"/.test(protocolSource)) {
    throw new Error(`Could not find DILIGENT_VERSION in ${PROTOCOL_PATH}`);
  }
  return protocolSource.replace(
    /export const DILIGENT_VERSION = "[^"]+"/,
    `export const DILIGENT_VERSION = "${version}"`,
  );
}

export function patchTauriConfigContent(tauriSource: string, version: string, options?: InjectVersionOptions): string {
  const tauriConf = JSON.parse(tauriSource) as TauriConfig;
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

  return `${JSON.stringify(tauriConf, null, 2)}\n`;
}

export function injectVersion(version: string, options?: InjectVersionOptions): VersionBackup {
  const protocolOriginal = readFileSync(PROTOCOL_PATH, "utf-8");
  const patchedProtocol = patchProtocolVersionContent(protocolOriginal, version);
  writeFileSync(PROTOCOL_PATH, patchedProtocol);

  const tauriOriginal = readFileSync(TAURI_CONF_PATH, "utf-8");
  const patchedTauri = patchTauriConfigContent(tauriOriginal, version, options);
  mkdirSync(TAURI_TEMP_CONFIG_DIR, { recursive: true });
  writeFileSync(TAURI_TEMP_CONFIG_PATH, patchedTauri);

  return { protocolOriginal, tauriTempConfigPath: TAURI_TEMP_CONFIG_PATH };
}

export function restoreVersion(backup: VersionBackup): void {
  writeFileSync(PROTOCOL_PATH, backup.protocolOriginal);
  rmSync(backup.tauriTempConfigPath, { force: true });
}
