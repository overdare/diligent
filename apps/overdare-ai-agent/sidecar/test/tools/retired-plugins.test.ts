// @summary Tests that the runtime never loads leftover retired first-party plugin copies from the global plugin root.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildToolCatalog, getGlobalPluginPath } from "@diligent/runtime";
import { createStudioBundledToolProviders } from "../../src/tools";

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
