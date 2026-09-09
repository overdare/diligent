// @summary Tests the platform assets staged into OVERDARE runtime release bundles.

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stageSidecarAssets, stageWebClient } from "../../../../scripts/build-overdare-runtime-bundle";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("OVERDARE runtime bundle assets", () => {
  test("stages the built client index and nested assets at the installed dist/client path", () => {
    const clientDist = mkdtempSync(join(tmpdir(), "overdare-runtime-client-"));
    const stageDir = mkdtempSync(join(tmpdir(), "overdare-runtime-stage-"));
    temporaryDirectories.push(clientDist, stageDir);
    mkdirSync(join(clientDist, "assets"), { recursive: true });
    writeFileSync(join(clientDist, "index.html"), "<!doctype html><title>OVERDARE</title>");
    writeFileSync(join(clientDist, "assets", "app-hash.js"), "console.log('client')");

    stageWebClient(clientDist, stageDir);

    expect(readFileSync(join(stageDir, "dist", "client", "index.html"), "utf8")).toContain("OVERDARE");
    expect(existsSync(join(stageDir, "dist", "client", "assets", "app-hash.js"))).toBe(true);
  });

  test("stages neither the retired procedural runtime nor the retired luau-lsp assets", () => {
    const stageDir = mkdtempSync(join(tmpdir(), "overdare-runtime-assets-"));
    temporaryDirectories.push(stageDir);

    stageSidecarAssets(stageDir);

    // The procedural runner went with Editor Luau; luau-lsp went with Studio's lua.validate.
    expect(existsSync(join(stageDir, "assets", "bin", "luau.exe"))).toBe(false);
    expect(existsSync(join(stageDir, "assets", "lua", "procedural"))).toBe(false);
    expect(existsSync(join(stageDir, "assets", "bin", "luau-lsp.exe"))).toBe(false);
    expect(existsSync(join(stageDir, "assets", "lua", "overdare-types.d.lua"))).toBe(false);
    // The layout itself stays — the sidecar resolves assets/bin for rg.
    expect(existsSync(join(stageDir, "assets", "bin"))).toBe(true);
  });
});
