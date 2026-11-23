// @summary Tests for language server catalog resolution, PATH/PATHEXT lookup, and root discovery
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LspManager } from "../../../src/tools/lsp/manager";
import { DEFAULT_LSP_SERVERS, findServerRoot, resolveCommand, resolveLspServers } from "../../../src/tools/lsp/servers";
import { createLspTool } from "../../../src/tools/lsp/tool";
import { LspWorkspace } from "../../../src/tools/lsp/workspace";
import { makeToolContext } from "../../helpers/lsp";

let dir: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "lsp-servers-")));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function executable(path: string, body = "#!/bin/sh\nexit 0\n"): Promise<string> {
  await writeFile(path, body);
  await chmod(path, 0o755);
  return path;
}

describe("resolveCommand", () => {
  test.skipIf(process.platform === "win32")("finds an executable on PATH and skips non-executable files", async () => {
    const first = join(dir, "first");
    const second = join(dir, "second");
    await mkdir(first);
    await mkdir(second);
    await writeFile(join(first, "tool-ls"), "not executable");
    const found = await executable(join(second, "tool-ls"));

    expect(resolveCommand("tool-ls", { PATH: `${first}:${second}` }, "linux")).toBe(found);
    expect(resolveCommand("missing-ls", { PATH: `${first}:${second}` }, "linux")).toBeUndefined();
  });

  test("on Windows tries PATHEXT extensions so npm .cmd shims resolve", async () => {
    await writeFile(join(dir, "tool-ls.cmd"), "@echo off");

    expect(resolveCommand("tool-ls", { PATH: dir, PATHEXT: ".exe;.cmd" }, "win32")).toBe(join(dir, "tool-ls.cmd"));
    expect(resolveCommand("tool-ls", { PATH: dir, PATHEXT: ".EXE" }, "win32")).toBeUndefined();
  });
});

describe("resolveLspServers", () => {
  const onPath = (command: string) => `/bin/${command}`;

  test("a configured entry named like a default overrides only the fields it sets", () => {
    const { servers } = resolveLspServers({ typescript: { args: ["--stdio", "--log-level", "4"] } }, onPath);
    const typescript = servers.find((server) => server.name === "typescript");
    expect(typescript).toMatchObject({
      command: `/bin/${DEFAULT_LSP_SERVERS.typescript!.command}`,
      args: ["--stdio", "--log-level", "4"],
      fileTypes: DEFAULT_LSP_SERVERS.typescript!.fileTypes,
    });
  });

  test("a disabled default is dropped without looking up its command", () => {
    const looked: string[] = [];
    const { servers, unavailable } = resolveLspServers({ luau: { enabled: false } }, (command) => {
      looked.push(command);
      return `/bin/${command}`;
    });
    expect(servers.map((server) => server.name)).not.toContain("luau");
    expect(unavailable.map((server) => server.name)).not.toContain("luau");
    expect(looked).not.toContain(DEFAULT_LSP_SERVERS.luau!.command);
  });

  test("defaults whose command is missing and incomplete custom entries are reported unavailable", () => {
    const { servers, unavailable } = resolveLspServers({ custom: { command: "custom-ls" } }, () => undefined);
    expect(servers).toEqual([]);
    expect(unavailable).toContainEqual({ name: "custom", reason: "needs `command` and `fileTypes`" });
    expect(unavailable.map((server) => server.name)).toEqual(expect.arrayContaining(Object.keys(DEFAULT_LSP_SERVERS)));
  });
});

describe("findServerRoot", () => {
  test("returns the nearest ancestor with a marker, bounded by cwd", async () => {
    const cwd = join(dir, "repo");
    await mkdir(join(cwd, "packages", "app", "src"), { recursive: true });
    await writeFile(join(dir, "marker.json"), "{}"); // above cwd: never reached
    await writeFile(join(cwd, "packages", "app", "marker.json"), "{}");
    const file = join(cwd, "packages", "app", "src", "main.x");
    const loose = join(cwd, "packages", "other.x");

    expect(findServerRoot(file, ["marker.json"], cwd)).toBe(join(cwd, "packages", "app"));
    expect(findServerRoot(loose, ["marker.json"], cwd)).toBe(cwd);
  });
});

describe("disabled built-in default", () => {
  test.skipIf(process.platform === "win32")("never starts even when its command is on PATH", async () => {
    const bin = join(dir, "bin");
    await mkdir(bin);
    const started = join(dir, "luau-started");
    await executable(join(bin, DEFAULT_LSP_SERVERS.luau!.command), `#!/bin/sh\ntouch "${started}"\nsleep 5\n`);
    await writeFile(join(dir, "main.luau"), "local x = 1\n");
    const lookup = (command: string) => resolveCommand(command, { PATH: bin }, "linux");

    // Control: without the override the default resolves to the binary on PATH.
    expect(resolveLspServers(undefined, lookup).servers.map((server) => server.name)).toContain("luau");

    const manager = new LspManager();
    const workspace = new LspWorkspace(
      dir,
      manager,
      { servers: { luau: { enabled: false } } },
      { resolveCommand: lookup },
    );
    const tool = createLspTool({ workspace });
    try {
      const result = await tool.execute({ action: "symbols", file: "main.luau" }, makeToolContext());
      expect(result.metadata?.error).toBe(true);
      expect(result.output).toContain("No language server handles main.luau");
      const status = await tool.execute({ action: "status" }, makeToolContext());
      expect(status.output).not.toContain("luau");
      expect(await Bun.file(started).exists()).toBe(false);
      expect(manager.status()).toEqual([]);
    } finally {
      await manager.shutdown();
    }
  });
});
