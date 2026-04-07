// @summary Integration test: verifies the build-time plugin bundle output matches runtime plugin-loader expectations.

import { expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { prepareBootstrapResources } from "../../scripts/lib/bootstrap";

/**
 * This integration test guards the contract between two independent plugin loading paths:
 *
 *   Build-time: apps/overdare-agent/scripts/lib/bootstrap.ts → createPluginBundlePlan → bun build
 *   Runtime:    packages/runtime/src/tools/plugin-loader.ts → importPluginModule → import(dir)
 *
 * If the runtime loader changes its discovery logic (directory structure, package.json shape,
 * entry point convention), this test will fail, preventing silent divergence.
 *
 * plugin-loader.ts contract (as of 2026-03-29):
 *   - Plugin directory contains package.json with: name, type, main fields
 *   - package.json#main resolves to the entry point JS file
 *   - Entry point exports: manifest { name, apiVersion, version } and createTools(): PluginTool[]
 */
test("plugin bundled by prepareBootstrapResources satisfies runtime plugin-loader contract", async () => {
  const rootDir = join(tmpdir(), `desktop-plugin-bundle-loader-${Date.now()}`);
  const desktopDir = join(rootDir, "apps/overdare-agent");
  const bootstrapDir = join(desktopDir, "bootstrap");
  const bootstrapResourcesDir = join(desktopDir, "src-tauri/resources/bootstrap");
  const pluginDir = join(desktopDir, "plugins", "test-plugin");
  const pluginSrcDir = join(pluginDir, "src");

  mkdirSync(bootstrapDir, { recursive: true });
  mkdirSync(pluginSrcDir, { recursive: true });

  writeFileSync(
    join(pluginDir, "package.json"),
    `${JSON.stringify({ name: "test-plugin", version: "0.2.0" }, null, 2)}\n`,
  );

  // Minimal plugin that satisfies the plugin-loader shape requirements:
  //   manifest: { name, apiVersion, version }
  //   createTools(): array of { name, description, parameters.parse, execute }
  writeFileSync(
    join(pluginSrcDir, "index.ts"),
    `export const manifest = {
  name: "test-plugin",
  apiVersion: "1.0.0",
  version: "0.2.0",
};

export async function createTools() {
  return [
    {
      name: "test_tool",
      description: "A minimal test tool for integration testing.",
      parameters: { parse: (v: unknown) => v },
      execute: async (_args: unknown) => ({ output: "ok" }),
    },
  ];
}
`,
  );

  try {
    prepareBootstrapResources({
      rootDir,
      desktopDir,
      run(command, cwd) {
        execSync(command, { cwd, stdio: "pipe" });
      },
    });

    // --- Verify directory structure ---
    const outDir = join(bootstrapResourcesDir, "plugins", "test-plugin");
    expect(existsSync(outDir)).toBe(true);

    // --- Verify package.json shape matches what plugin-loader.ts expects ---
    // plugin-loader imports a directory path; Bun resolves it via package.json#main
    const pkgJson = JSON.parse(readFileSync(join(outDir, "package.json"), "utf-8")) as {
      name?: unknown;
      version?: unknown;
      type?: unknown;
      main?: unknown;
    };
    expect(pkgJson.name).toBe("test-plugin");
    expect(typeof pkgJson.version).toBe("string");
    expect(pkgJson.type).toBe("module"); // required for ESM import()
    expect(pkgJson.main).toBe("index.js"); // plugin-loader resolves import(dir) via this field

    // --- Verify the bundled entry point exists ---
    expect(typeof pkgJson.main).toBe("string");
    const entryPath = join(outDir, pkgJson.main as string);
    expect(existsSync(entryPath)).toBe(true);

    // --- Verify the bundled module exports what plugin-loader requires ---
    // plugin-loader.ts checks: manifest.name, manifest.apiVersion, manifest.version, createTools()
    const mod = (await import(pathToFileURL(entryPath).href)) as {
      manifest?: { name: string; apiVersion: string; version: string };
      createTools?: () => Promise<
        Array<{ name: string; description: string; parameters: { parse: (v: unknown) => unknown }; execute: unknown }>
      >;
    };

    expect(typeof mod.manifest).toBe("object");
    expect(mod.manifest?.name).toBe("test-plugin");
    expect(typeof mod.manifest?.apiVersion).toBe("string");
    expect(typeof mod.manifest?.version).toBe("string");

    expect(typeof mod.createTools).toBe("function");
    const tools = await mod.createTools!();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);

    // Verify each tool has the shape plugin-loader validates (isValidToolShape)
    for (const tool of tools) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.description).toBe("string");
      expect(typeof tool.parameters?.parse).toBe("function");
      expect(typeof tool.execute).toBe("function");
    }
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
