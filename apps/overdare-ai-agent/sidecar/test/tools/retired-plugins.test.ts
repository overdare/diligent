// @summary Tests that the runtime deletes retired first-party plugin copies and never loads any that remain.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildToolCatalog, getGlobalPluginPath } from "@diligent/runtime";
import { createStudioBundledToolProviders } from "../../src/tools";
import { removeRetiredPluginCopies } from "../../src/tools/retired-plugins";

const LEGACY_VALIDATOR = "@overdare/plugin-validator";
const ORIGINAL_HOME = process.env.HOME;
let home = "";

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "overdare-retired-plugins-"));
  process.env.HOME = home;
  const pluginDir = getGlobalPluginPath(LEGACY_VALIDATOR);
  await Bun.write(
    join(pluginDir, "package.json"),
    JSON.stringify({ name: LEGACY_VALIDATOR, version: "0.0.1", type: "module", main: "./index.js" }),
  );
  await Bun.write(
    join(pluginDir, "index.js"),
    [
      `export const manifest = { name: "${LEGACY_VALIDATOR}", apiVersion: "1.0", version: "0.0.1" };`,
      "export function createTools() {",
      '  return [{ name: "validatelua", description: "legacy", parameters: { parse: (value) => value },',
      '    execute: async () => ({ output: "Failed to load definitions" }) }];',
      "}",
    ].join("\n"),
  );
});

afterAll(async () => {
  process.env.HOME = ORIGINAL_HOME;
  await rm(home, { recursive: true, force: true });
});

describe("retired plugin copies", () => {
  test("a leftover legacy validator copy exposes validatelua when the runtime does not retire it", async () => {
    const catalog = await buildToolCatalog([], {}, home);
    expect(catalog.tools.map((tool) => tool.name)).toContain("validatelua");
  });

  test("the Studio runtime keeps the leftover validator out of the catalog, with or without Studio", async () => {
    for (const studioDisabled of [false, true]) {
      const catalog = await buildToolCatalog([], {}, home, undefined, {
        bundledProviders: createStudioBundledToolProviders({ cwd: home, studioDisabled }),
      });
      expect(
        catalog.tools.map((tool) => tool.name),
        String(studioDisabled),
      ).not.toContain("validatelua");
    }
  });
});

describe("removeRetiredPluginCopies", () => {
  test("deletes only retired packages and leaves same-scope and user plugins", async () => {
    const root = await mkdtemp(join(tmpdir(), "overdare-plugin-root-"));
    try {
      for (const path of [
        "@overdare/plugin-validator",
        "@overdare/plugin-rag",
        "@overdare/plugin-other",
        "user-plugin",
      ])
        await Bun.write(join(root, path, "index.js"), "export {};");
      expect((await removeRetiredPluginCopies(root)).sort()).toEqual([
        "@overdare/plugin-rag",
        "@overdare/plugin-validator",
      ]);
      expect(existsSync(join(root, "@overdare/plugin-validator"))).toBe(false);
      expect(existsSync(join(root, "@overdare/plugin-rag"))).toBe(false);
      expect(existsSync(join(root, "@overdare/plugin-other/index.js"))).toBe(true);
      expect(existsSync(join(root, "user-plugin/index.js"))).toBe(true);
      expect(await removeRetiredPluginCopies(root)).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test.skipIf(process.platform === "win32")(
    "never follows a linked plugin root or scope out of global storage",
    async () => {
      const base = await mkdtemp(join(tmpdir(), "overdare-plugin-links-"));
      try {
        const outside = join(base, "outside");
        await Bun.write(join(outside, "@overdare/plugin-validator/index.js"), "external");
        await symlink(outside, join(base, "linked-root"));
        expect(await removeRetiredPluginCopies(join(base, "linked-root"))).toEqual([]);

        const root = join(base, "root");
        await Bun.write(join(root, "keep.txt"), "");
        await symlink(join(outside, "@overdare"), join(root, "@overdare"));
        expect(await removeRetiredPluginCopies(root)).toEqual([]);
        expect(existsSync(join(outside, "@overdare/plugin-validator/index.js"))).toBe(true);
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    },
  );
});
