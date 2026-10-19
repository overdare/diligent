// @summary Tests for ripgrep binary resolution (env override, bundled asset, PATH, unavailable)
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveRgBinary } from "../../src/util/ripgrep";

describe("resolveRgBinary", () => {
  const originalEnv = process.env.DILIGENT_RG_PATH;
  const originalPath = process.env.PATH;
  const binName = process.platform === "win32" ? "rg.exe" : "rg";
  const bundled = join(dirname(process.execPath), "assets", "bin", binName);
  let pathDir: string;

  beforeEach(() => {
    delete process.env.DILIGENT_RG_PATH;
    pathDir = mkdtempSync(join(tmpdir(), "rg-path-"));
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.DILIGENT_RG_PATH;
    else process.env.DILIGENT_RG_PATH = originalEnv;
    process.env.PATH = originalPath;
    rmSync(pathDir, { recursive: true, force: true });
  });

  test("prefers DILIGENT_RG_PATH when set", () => {
    process.env.DILIGENT_RG_PATH = "/custom/rg";
    expect(resolveRgBinary()).toBe("/custom/rg");
  });

  test("falls back to a bundled assets/bin binary next to execPath", () => {
    const created = !existsSync(bundled);
    if (created) {
      mkdirSync(dirname(bundled), { recursive: true });
      writeFileSync(bundled, "");
    }
    try {
      expect(resolveRgBinary()).toBe(bundled);
    } finally {
      if (created) rmSync(bundled);
    }
  });

  test("falls back to an rg executable found on PATH", () => {
    if (existsSync(bundled)) return; // a real bundled asset takes precedence on this host
    const onPath = join(pathDir, binName);
    writeFileSync(onPath, "#!/bin/sh\n");
    chmodSync(onPath, 0o755);
    process.env.PATH = pathDir;
    expect(resolveRgBinary()).toBe(onPath);
  });

  test("returns null when rg is not resolvable anywhere", () => {
    if (existsSync(bundled)) return; // a real bundled asset takes precedence on this host
    process.env.PATH = pathDir;
    expect(resolveRgBinary()).toBeNull();
  });
});
