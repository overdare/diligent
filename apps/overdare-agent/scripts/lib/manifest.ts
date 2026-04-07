// @summary Generate update manifest for runtime auto-update

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PlatformTarget } from "./platforms";

interface UpdateManifest {
  version: string;
  releaseDate: string;
  platforms: Record<
    string,
    {
      url: string;
      sha256: string;
      size: number;
    }
  >;
}

interface GenerateManifestOptions {
  version: string;
  distDir: string;
  platforms: PlatformTarget[];
  baseUrl: string;
  projectArtifactName: string;
}

export function generateUpdateManifest(options: GenerateManifestOptions): void {
  const manifest: UpdateManifest = {
    version: options.version,
    releaseDate: new Date().toISOString(),
    platforms: {},
  };

  for (const plat of options.platforms) {
    const bundleName = `${options.projectArtifactName}-runtime-${options.version}-${plat.id}.zip`;
    const bundlePath = join(options.distDir, bundleName);

    if (!existsSync(bundlePath)) continue;

    const data = readFileSync(bundlePath);
    const sha256 = createHash("sha256").update(data).digest("hex");

    manifest.platforms[plat.id] = {
      url: `${options.baseUrl}/${bundleName}`,
      sha256,
      size: data.length,
    };
  }

  writeFileSync(join(options.distDir, "update-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
