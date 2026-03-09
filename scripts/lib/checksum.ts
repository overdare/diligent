// @summary SHA256 checksum generation for release artifacts

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

export function generateChecksums(distDir: string): void {
  const files = collectFiles(distDir).filter(
    (f) => !f.endsWith("checksums.sha256") && !f.endsWith("release-meta.json"),
  );
  const lines: string[] = [];
  for (const file of files.sort()) {
    const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
    lines.push(`${hash}  ${relative(distDir, file)}`);
  }
  writeFileSync(join(distDir, "checksums.sha256"), lines.join("\n") + "\n");
}
