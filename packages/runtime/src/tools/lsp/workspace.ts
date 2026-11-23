// @summary Thread-scoped view of the language server manager: server lookup by file, disk re-sync, diagnostics retrieval
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { Diagnostic, DocumentDiagnosticReport } from "vscode-languageserver-protocol";
import type { LspConfig } from "../../config/schema";
import { type LspClient, pathToUri } from "./client";
import type { AcquireOptions, LspManager } from "./manager";
import {
  type LspServerCatalog,
  type LspServerSpec,
  type PostEditDiagnosticsMode,
  resolveLspServers,
  serverForFile,
} from "./servers";

export interface LspWorkspaceOptions {
  /** Test seam for PATH lookups; defaults to the process PATH. */
  resolveCommand?: (command: string) => string | undefined;
}

export interface AcquiredServer {
  client: LspClient;
  spec: LspServerSpec;
}

/**
 * Binds the process-wide manager to one working directory and the effective `lsp` config. The server catalog
 * (PATH lookups) is resolved on first use.
 */
export class LspWorkspace {
  private catalogCache: LspServerCatalog | undefined;
  readonly postEditDiagnostics: PostEditDiagnosticsMode;

  constructor(
    readonly cwd: string,
    readonly manager: LspManager,
    private readonly config: LspConfig | undefined,
    private readonly options: LspWorkspaceOptions = {},
  ) {
    this.postEditDiagnostics = config?.postEditDiagnostics ?? "running";
  }

  get catalog(): LspServerCatalog {
    this.catalogCache ??= resolveLspServers(this.config?.servers, this.options.resolveCommand);
    return this.catalogCache;
  }

  resolvePath(file: string): string {
    return resolve(this.cwd, file);
  }

  /** `path` relative to the working directory when inside it, else absolute. */
  displayPath(path: string): string {
    const rel = relative(this.cwd, path);
    return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.replaceAll("\\", "/") : path;
  }

  serverFor(path: string): LspServerSpec | undefined {
    return serverForFile(this.catalog.servers, path);
  }

  async acquire(path: string, options: AcquireOptions): Promise<AcquiredServer | undefined> {
    const spec = this.serverFor(path);
    if (!spec) return undefined;
    const client = await this.manager.acquire(spec, this.manager.rootFor(spec, path, this.cwd), options);
    return client ? { client, spec } : undefined;
  }

  /** Re-sync `path` from disk; returns the synced version. */
  async syncFromDisk(client: LspClient, path: string): Promise<number> {
    return client.sync(path, await readFile(path, "utf-8"));
  }

  /** Re-sync every open document of `client` from disk, closing those that no longer exist. */
  async syncOpenDocuments(client: LspClient): Promise<void> {
    for (const path of client.openPaths()) {
      const text = await readFile(path, "utf-8").catch(() => undefined);
      if (text === undefined) await client.close(path);
      else await client.sync(path, text);
    }
  }

  /**
   * Diagnostics for the synced `version` of `path`: pulled when the server supports `textDocument/diagnostic`,
   * otherwise the cached publish for this version or the next one within `timeoutMs`. `undefined` when none came.
   */
  async diagnostics(
    client: LspClient,
    path: string,
    version: number,
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<Diagnostic[] | undefined> {
    if (client.capabilities.diagnosticProvider) {
      try {
        const report = await client.request<DocumentDiagnosticReport>(
          "textDocument/diagnostic",
          { textDocument: { uri: pathToUri(path) } },
          options,
        );
        if (report.kind === "full") return report.items;
      } catch {
        // Fall back to published diagnostics.
      }
    }
    const cached = client.latestDiagnostics(path);
    if (cached && cached.version >= version) return cached.diagnostics;
    return client.waitForDiagnostics(path, version, options);
  }
}
