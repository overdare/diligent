// @summary Regression tests for desktop bootstrap resource assembly used by dev/build and packaging.

import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareBootstrapResources } from "../../scripts/lib/bootstrap";

test("prepareBootstrapResources creates Tauri bootstrap resources from desktop bootstrap content", () => {
  const rootDir = join(tmpdir(), `desktop-bootstrap-root-${Date.now()}`);
  const desktopDir = join(rootDir, "apps/overdare-agent");
  const bootstrapDir = join(desktopDir, "bootstrap");
  const bootstrapResourcesDir = join(desktopDir, "src-tauri/resources/bootstrap");

  mkdirSync(bootstrapDir, { recursive: true });
  writeFileSync(join(bootstrapDir, "config.jsonc"), '{"ok":true}\n');

  try {
    prepareBootstrapResources({
      rootDir,
      desktopDir,
      run() {
        throw new Error("run should not be called without plugins");
      },
    });

    expect(existsSync(join(bootstrapResourcesDir, "plugins"))).toBe(true);
    expect(readFileSync(join(bootstrapResourcesDir, "config.jsonc"), "utf-8")).toBe('{"ok":true}\n');
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});

test("prepareBootstrapResources copies bootstrap subdirectories and excludes unrelated app roots", () => {
  const rootDir = join(tmpdir(), `desktop-bootstrap-package-root-${Date.now()}`);
  const desktopDir = join(rootDir, "apps/overdare-agent");
  const bootstrapDir = join(desktopDir, "bootstrap");
  const bootstrapResourcesDir = join(desktopDir, "src-tauri/resources/bootstrap");

  mkdirSync(join(bootstrapDir, "agents"), { recursive: true });
  mkdirSync(join(bootstrapDir, "skills"), { recursive: true });
  writeFileSync(join(bootstrapDir, "config.jsonc"), '{"ok":true}\n');
  writeFileSync(join(bootstrapDir, "agents", "agent.md"), "# bootstrap agent\n");
  writeFileSync(join(bootstrapDir, "skills", "skill.md"), "# bootstrap skill\n");

  mkdirSync(join(desktopDir, "icons"), { recursive: true });
  writeFileSync(join(desktopDir, "icons", "icon.png"), "png");

  mkdirSync(join(desktopDir, "scripts"), { recursive: true });
  writeFileSync(join(desktopDir, "scripts", "tool.ts"), "console.log('dev script');\n");

  mkdirSync(join(desktopDir, "supabase", "functions"), { recursive: true });
  writeFileSync(join(desktopDir, "supabase", "functions", "index.ts"), "export {}\n");

  try {
    prepareBootstrapResources({
      rootDir,
      desktopDir,
      run() {},
    });

    expect(existsSync(join(bootstrapResourcesDir, "agents", "agent.md"))).toBe(true);
    expect(readFileSync(join(bootstrapResourcesDir, "agents", "agent.md"), "utf-8")).toBe("# bootstrap agent\n");
    expect(existsSync(join(bootstrapResourcesDir, "skills", "skill.md"))).toBe(true);
    expect(readFileSync(join(bootstrapResourcesDir, "skills", "skill.md"), "utf-8")).toBe("# bootstrap skill\n");

    expect(existsSync(join(bootstrapResourcesDir, "icons"))).toBe(false);
    expect(existsSync(join(bootstrapResourcesDir, "scripts"))).toBe(false);
    expect(existsSync(join(bootstrapResourcesDir, "supabase"))).toBe(false);
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
