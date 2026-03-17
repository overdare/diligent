// @summary Resolves user-visible project naming from root or package metadata for packaging

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../../..");
const DEFAULT_PROJECT_NAME = "Diligent";

interface DiligentPackageConfig {
  projectName?: string;
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
  const packagePath = packageDir ? join(packageDir, "package.json") : null;
  const packageName = normalizeProjectName(
    packagePath ? readPackageJson(packagePath)?.diligent?.projectName : undefined,
  );
  if (packageName) return packageName;

  const rootName = normalizeProjectName(readPackageJson(join(ROOT, "package.json"))?.diligent?.projectName);
  return rootName ?? DEFAULT_PROJECT_NAME;
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
