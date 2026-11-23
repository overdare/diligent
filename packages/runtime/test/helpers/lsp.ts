// @summary Helpers for LSP tests: a temp project served by the fake stdio language server fixture
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@diligent/core/tool-contract";
import type { LspConfig, LspServerConfig } from "../../src/config/schema";
import { LspManager, type LspManagerOptions } from "../../src/tools/lsp/manager";
import { LspWorkspace } from "../../src/tools/lsp/workspace";

export const FAKE_LSP_PATH = join(import.meta.dir, "../fixtures/fake-lsp.ts");

export interface FakeServerOptions {
  silent?: boolean;
  crashOn?: string;
  failInitialize?: boolean;
}

export interface FakeLspProject {
  dir: string;
  logFile: string;
  manager: LspManager;
  workspace: LspWorkspace;
  /** Methods the fake server received, in order, across all its processes. */
  log(): Promise<string[]>;
  cleanup(): Promise<void>;
}

/** Server entry running the fake fixture for `.fake` files, rooted at directories containing `fake.json`. */
export function fakeServerConfig(logFile: string, options: FakeServerOptions = {}): LspServerConfig {
  return {
    command: process.execPath,
    args: [FAKE_LSP_PATH],
    fileTypes: [".fake"],
    rootMarkers: ["fake.json"],
    initOptions: { logFile, ...options },
  };
}

export async function createFakeLspProject(
  options: { server?: FakeServerOptions; lsp?: Omit<LspConfig, "servers">; manager?: LspManagerOptions } = {},
): Promise<FakeLspProject> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "lsp-test-")));
  const logFile = join(dir, "server.log");
  const manager = new LspManager(options.manager);
  const workspace = new LspWorkspace(
    dir,
    manager,
    { ...options.lsp, servers: { fake: fakeServerConfig(logFile, options.server) } },
    // Only the fake server: built-in defaults must not depend on the host PATH.
    { resolveCommand: (command) => (command === process.execPath ? command : undefined) },
  );
  return {
    dir,
    logFile,
    manager,
    workspace,
    log: async () => (await readFile(logFile, "utf-8").catch(() => "")).split("\n").filter(Boolean),
    cleanup: async () => {
      await manager.shutdown();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export function makeToolContext(signal = new AbortController().signal): ToolContext {
  return { toolCallId: "tc_lsp", signal, abort: () => {} };
}
