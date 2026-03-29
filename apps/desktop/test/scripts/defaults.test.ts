// @summary Regression tests for desktop defaults resource assembly used by dev/build and packaging.

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareDefaultsResources } from "../../scripts/lib/defaults";

test("prepareDefaultsResources creates Tauri defaults resources from desktop defaults", () => {
  const rootDir = join(tmpdir(), `desktop-defaults-root-${Date.now()}`);
  const desktopDir = join(rootDir, "apps/desktop");
  const defaultsDir = join(desktopDir, "defaults");
  const defaultsResourcesDir = join(desktopDir, "src-tauri/resources/defaults");

  mkdirSync(defaultsDir, { recursive: true });
  writeFileSync(join(defaultsDir, "config.jsonc"), '{"ok":true}\n');

  try {
    prepareDefaultsResources({
      rootDir,
      desktopDir,
      run() {
        throw new Error("run should not be called without a packageDir");
      },
    });

    expect(existsSync(join(defaultsResourcesDir, "plugins"))).toBe(true);
    expect(readFileSync(join(defaultsResourcesDir, "config.jsonc"), "utf-8")).toBe('{"ok":true}\n');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
