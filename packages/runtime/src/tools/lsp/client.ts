// @summary One language server process over stdio JSON-RPC: initialize, full-text document sync, diagnostics, requests
import { type ChildProcess, spawn } from "node:child_process";
import { basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CancellationTokenSource,
  createMessageConnection,
  type MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
import type {
  Diagnostic,
  InitializeParams,
  InitializeResult,
  PublishDiagnosticsParams,
  ServerCapabilities,
} from "vscode-languageserver-protocol";
import { type LspServerSpec, languageIdFor } from "./servers";

const INITIALIZE_TIMEOUT_MS = 60_000;
const SHUTDOWN_GRACE_MS = 1_000;
const STDERR_TAIL_BYTES = 4_096;

export class LspRequestTimeoutError extends Error {
  constructor(method: string, timeoutMs: number) {
    super(`${method} timed out after ${Math.round(timeoutMs / 1000)}s`);
  }
}

export interface LspClientOptions {
  /** Called once when the process exits without `shutdown()`. */
  onUnexpectedExit?: (reason: string) => void;
}

export interface RequestOptions {
  timeoutMs: number;
  signal?: AbortSignal;
}

interface OpenDocument {
  version: number;
  text: string;
}

interface DiagnosticsEntry {
  diagnostics: Diagnostic[];
  /** Document version these diagnostics describe: the published version, else the version synced at receipt. */
  version: number;
}

export function pathToUri(path: string): string {
  return pathToFileURL(path).href;
}

export function uriToPath(uri: string): string {
  return uri.startsWith("file:") ? fileURLToPath(uri) : uri;
}

export class LspClient {
  private readonly documents = new Map<string, OpenDocument>();
  private readonly diagnostics = new Map<string, DiagnosticsEntry>();
  private readonly diagnosticListeners = new Set<(uri: string) => void>();
  private stopping = false;
  private exited = false;
  private stderrTail = "";
  private exitStatus: string | undefined;
  capabilities: ServerCapabilities = {};

  private constructor(
    readonly spec: LspServerSpec,
    readonly root: string,
    private readonly process: ChildProcess,
    private readonly connection: MessageConnection,
  ) {}

  /** Spawn the server, run initialize/initialized, and push `settings` when configured. */
  static async start(spec: LspServerSpec, root: string, options: LspClientOptions = {}): Promise<LspClient> {
    const windowsShim = process.platform === "win32" && /\.(cmd|bat)$/i.test(spec.command);
    const child = spawn(
      windowsShim ? quoteForCmd(spec.command) : spec.command,
      windowsShim ? spec.args.map(quoteForCmd) : spec.args,
      { cwd: root, stdio: ["pipe", "pipe", "pipe"], shell: windowsShim, windowsHide: true },
    );
    const spawned = Promise.withResolvers<void>();
    child.once("spawn", () => spawned.resolve());
    child.once("error", spawned.reject);
    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout!),
      new StreamMessageWriter(child.stdin!),
    );
    const client = new LspClient(spec, root, child, connection);
    client.wire(options);
    connection.listen();
    try {
      await spawned;
      const params: InitializeParams = {
        processId: process.pid,
        clientInfo: { name: "diligent" },
        rootUri: pathToUri(root),
        workspaceFolders: [{ uri: pathToUri(root), name: basename(root) }],
        initializationOptions: spec.initOptions,
        capabilities: {
          general: { positionEncodings: ["utf-16"] },
          workspace: {
            configuration: true,
            workspaceFolders: true,
            symbol: {},
            workspaceEdit: { documentChanges: true },
          },
          textDocument: {
            synchronization: { didSave: false, dynamicRegistration: false },
            publishDiagnostics: { versionSupport: true, relatedInformation: false },
            definition: { linkSupport: true },
            typeDefinition: { linkSupport: true },
            implementation: { linkSupport: true },
            references: {},
            hover: { contentFormat: ["markdown", "plaintext"] },
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            rename: { prepareSupport: false },
          },
        },
      };
      const result = await client.request<InitializeResult>("initialize", params, {
        timeoutMs: INITIALIZE_TIMEOUT_MS,
      });
      client.capabilities = result.capabilities ?? {};
      await connection.sendNotification("initialized", {});
      if (spec.settings) {
        await connection.sendNotification("workspace/didChangeConfiguration", { settings: spec.settings });
      }
      return client;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason = client.exitStatus ? `${message} (${client.exitStatus})` : message;
      await client.shutdown();
      const stderr = client.stderrTail.trim().split("\n").slice(-5).join("\n");
      throw new Error(`${spec.name} failed to start: ${reason}${stderr ? `\n${stderr}` : ""}`);
    }
  }

  private wire(options: LspClientOptions): void {
    this.process.stderr?.on("data", (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString("utf-8")).slice(-STDERR_TAIL_BYTES);
    });
    this.process.stdin?.on("error", () => {});
    // A spawn failure (e.g. ENOENT) emits `error` and no `exit`.
    this.process.once("error", () => {
      this.exited = true;
      this.connection.dispose();
    });
    this.process.once("exit", (code, signal) => {
      this.exited = true;
      this.exitStatus = `exited with ${signal ? `signal ${signal}` : `code ${code}`}`;
      this.connection.dispose();
      if (this.stopping) return;
      const stderr = this.stderrTail.trim().split("\n").slice(-5).join("\n");
      options.onUnexpectedExit?.(`${this.exitStatus}${stderr ? `: ${stderr}` : ""}`);
    });
    this.connection.onError(() => {});
    this.connection.onNotification("textDocument/publishDiagnostics", (params: PublishDiagnosticsParams) => {
      const synced = this.documents.get(params.uri)?.version ?? 0;
      this.diagnostics.set(params.uri, { diagnostics: params.diagnostics, version: params.version ?? synced });
      for (const listener of this.diagnosticListeners) listener(params.uri);
    });
    this.connection.onRequest("workspace/configuration", (params: { items?: Array<{ section?: string }> }) =>
      (params.items ?? []).map((item) => lookupSection(this.spec.settings, item.section)),
    );
    this.connection.onRequest("workspace/workspaceFolders", () => [
      { uri: pathToUri(this.root), name: basename(this.root) },
    ]);
    this.connection.onRequest("client/registerCapability", () => null);
    this.connection.onRequest("client/unregisterCapability", () => null);
    this.connection.onRequest("window/workDoneProgress/create", () => null);
    this.connection.onRequest("window/showMessageRequest", () => null);
    this.connection.onRequest("window/showDocument", () => ({ success: false }));
    this.connection.onRequest("workspace/applyEdit", () => ({
      applied: false,
      failureReason: "Edits are applied through Diligent's write tools.",
    }));
  }

  get alive(): boolean {
    return !this.exited && !this.stopping;
  }

  isOpen(path: string): boolean {
    return this.documents.has(pathToUri(path));
  }

  openPaths(): string[] {
    return [...this.documents.keys()].map(uriToPath);
  }

  /** Make the server hold `text` for `path`: didOpen on first touch, full-text didChange when it differs. */
  async sync(path: string, text: string): Promise<number> {
    const uri = pathToUri(path);
    const open = this.documents.get(uri);
    if (!open) {
      this.documents.set(uri, { version: 1, text });
      await this.connection.sendNotification("textDocument/didOpen", {
        textDocument: { uri, languageId: languageIdFor(path), version: 1, text },
      });
      return 1;
    }
    if (open.text === text) return open.version;
    open.version += 1;
    open.text = text;
    await this.connection.sendNotification("textDocument/didChange", {
      textDocument: { uri, version: open.version },
      contentChanges: [{ text }],
    });
    return open.version;
  }

  async close(path: string): Promise<void> {
    const uri = pathToUri(path);
    if (!this.documents.delete(uri)) return;
    this.diagnostics.delete(uri);
    await this.connection.sendNotification("textDocument/didClose", { textDocument: { uri } });
  }

  /** The synced text and version of an open document. */
  document(path: string): { text: string; version: number } | undefined {
    const open = this.documents.get(pathToUri(path));
    return open ? { text: open.text, version: open.version } : undefined;
  }

  /** Latest diagnostics published for `path`, with the document version they describe. */
  latestDiagnostics(path: string): DiagnosticsEntry | undefined {
    return this.diagnostics.get(pathToUri(path));
  }

  /**
   * Resolve with the diagnostics published for `path` at `version` or later. After the first such publish, waits
   * `settleMs` for a follow-up publish (servers often publish syntax and semantic results separately) and returns the
   * latest. Resolves `undefined` when nothing arrives within `timeoutMs`.
   */
  waitForDiagnostics(
    path: string,
    version: number,
    options: { timeoutMs: number; settleMs?: number; signal?: AbortSignal },
  ): Promise<Diagnostic[] | undefined> {
    const uri = pathToUri(path);
    const settleMs = options.settleMs ?? 150;
    const { promise, resolve } = Promise.withResolvers<Diagnostic[] | undefined>();
    let latest: Diagnostic[] | undefined;
    let settleTimer: Timer | undefined;
    const finish = () => {
      clearTimeout(deadline);
      clearTimeout(settleTimer);
      this.diagnosticListeners.delete(listener);
      options.signal?.removeEventListener("abort", finish);
      resolve(latest);
    };
    const listener = (published: string) => {
      if (published !== uri) return;
      const entry = this.diagnostics.get(uri);
      if (!entry || entry.version < version) return;
      latest = entry.diagnostics;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(finish, settleMs);
    };
    const deadline = setTimeout(finish, options.timeoutMs);
    this.diagnosticListeners.add(listener);
    options.signal?.addEventListener("abort", finish, { once: true });
    if (options.signal?.aborted) finish();
    else listener(uri);
    return promise;
  }

  async request<R>(method: string, params: unknown, options: RequestOptions): Promise<R> {
    options.signal?.throwIfAborted();
    if (!this.alive) throw new Error(`${this.spec.name} is not running`);
    const cancel = new CancellationTokenSource();
    const interrupted = Promise.withResolvers<never>();
    const onAbort = () => {
      cancel.cancel();
      interrupted.reject(options.signal?.reason);
    };
    const timer = setTimeout(() => {
      cancel.cancel();
      interrupted.reject(new LspRequestTimeoutError(method, options.timeoutMs));
    }, options.timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const response = this.connection.sendRequest<R>(method, params, cancel.token);
    // A cancelled request rejects after the race has already settled.
    response.catch(() => {});
    try {
      return await Promise.race([response, interrupted.promise]);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      cancel.dispose();
    }
  }

  /** shutdown → exit, then kill the process if it has not exited after a grace period. */
  async shutdown(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    const exited = Promise.withResolvers<void>();
    if (this.exited) exited.resolve();
    else {
      this.process.once("exit", () => exited.resolve());
      this.process.once("error", () => exited.resolve());
      const polite = this.connection.sendRequest("shutdown").then(() => this.connection.sendNotification("exit"));
      polite.catch(() => {});
      await Promise.race([polite, exited.promise, Bun.sleep(SHUTDOWN_GRACE_MS)]);
    }
    const gone = await Promise.race([exited.promise.then(() => true), Bun.sleep(SHUTDOWN_GRACE_MS).then(() => false)]);
    if (!gone) {
      this.process.kill("SIGKILL");
      await Promise.race([exited.promise, Bun.sleep(SHUTDOWN_GRACE_MS)]);
    }
    this.connection.dispose();
  }
}

function lookupSection(settings: Record<string, unknown> | undefined, section: string | undefined): unknown {
  if (!settings) return null;
  if (!section) return settings;
  let value: unknown = settings;
  for (const key of section.split(".")) {
    if (!value || typeof value !== "object") return null;
    value = (value as Record<string, unknown>)[key];
  }
  return value ?? null;
}

function quoteForCmd(value: string): string {
  return /[\s"&|<>^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
