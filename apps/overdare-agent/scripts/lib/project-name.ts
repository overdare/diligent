// @summary Resolves app-owned branding metadata (name/icons) from the desktop app package for packaging

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const APP_ROOT = join(import.meta.dir, "../..");
const DEFAULT_PROJECT_NAME = "Diligent";

interface DiligentPackageConfig {
  projectName?: string;
  desktopIcons?: string[];
}

interface PackageJsonShape {
  diligent?: DiligentPackageConfig;
}

function readPackageJson(filePath: string): PackageJsonShape | null {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8")) as PackageJsonShape;
}

function normalizeProjectName(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveProjectName(packageDir?: string): string {
  const packagePath = packageDir ? join(packageDir, "package.json") : join(APP_ROOT, "package.json");
  const packageName = normalizeProjectName(readPackageJson(packagePath)?.diligent?.projectName);
  return packageName ?? DEFAULT_PROJECT_NAME;
}

export function toProjectArtifactName(projectName: string): string {
  const normalized = projectName
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[-\s]+/g, "-")
    .toLowerCase();

  return normalized.length > 0 ? normalized : DEFAULT_PROJECT_NAME.toLowerCase();
}

export function resolveDesktopIconPaths(packageDir?: string): string[] | undefined {
  const appDir = packageDir ?? APP_ROOT;
  const packageConfig = readPackageJson(join(appDir, "package.json"))?.diligent;
  if (!Array.isArray(packageConfig?.desktopIcons)) return undefined;

  const iconPaths = packageConfig.desktopIcons
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => join(appDir, value))
    .filter((value) => existsSync(value));

  return iconPaths.length > 0 ? iconPaths : undefined;
}
