// @summary Tests that the runtime skips retired first-party plugin copies even when the launcher never removed them.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildToolCatalog, getGlobalPluginPath } from "@diligent/runtime";
import { createRetiredPluginProvider } from "../../src/tools/retired-plugins";

const SHIPPED_BOOTSTRAP = resolve(import.meta.dir, "../../../bootstrap");
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
      '  return [{ name: "validatelua", description: "legacy", parameters: { type: "object", properties: {} },',
      '    execute: async () => ({ output: "Failed to load definitions" }) }];',
      "}",
    ].join("\n"),
  );
});

afterAll(async () => {
  process.env.HOME = ORIGINAL_HOME;
  await rm(home, { recursive: true, force: true });
});

describe("createRetiredPluginProvider", () => {
  test("a leftover legacy validator copy exposes validatelua when nothing retires it", async () => {
    const catalog = await buildToolCatalog([], {}, home, undefined, {
      bundledProviders: [createRetiredPluginProvider(undefined)],
    });
    expect(catalog.tools.map((tool) => tool.name)).toContain("validatelua");
  });

  test("the shipped plugins manifest keeps the leftover validator out of the runtime catalog", async () => {
    const catalog = await buildToolCatalog([], {}, home, undefined, {
      bundledProviders: [createRetiredPluginProvider(SHIPPED_BOOTSTRAP)],
    });
    expect(catalog.tools.map((tool) => tool.name)).not.toContain("validatelua");
  });

  test("a missing or malformed manifest retires nothing instead of failing startup", async () => {
    const empty = await mkdtemp(join(tmpdir(), "overdare-bootstrap-"));
    try {
      expect(createRetiredPluginProvider(empty).supersedesPluginPackages).toEqual([]);
      await Bun.write(join(empty, "plugins-manifest.json"), "{ not json");
      expect(createRetiredPluginProvider(empty).supersedesPluginPackages).toEqual([]);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
