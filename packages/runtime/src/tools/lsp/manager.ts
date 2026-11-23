// @summary Process-wide language server manager: lazy start per (server, root), idle shutdown, crash backoff, status
import { createLogger } from "@diligent/logging";
import { LspClient } from "./client";
import { findServerRoot, type LspServerSpec } from "./servers";

const logger = createLogger({ scope: "runtime.lsp" });

export const DEFAULT_LSP_IDLE_TIMEOUT_MS = 10 * 60_000;
/** Delay before restart attempt n after a crash; once exhausted, the server is failed until reload. */
export const DEFAULT_LSP_RESTART_BACKOFF_MS: readonly number[] = [1_000, 5_000, 30_000];

export interface LspManagerOptions {
  idleTimeoutMs?: number;
  restartBackoffMs?: readonly number[];
  /** Test seam for starting a server. */
  startClient?: (spec: LspServerSpec, root: string, onUnexpectedExit: (reason: string) => void) => Promise<LspClient>;
}

export interface LspServerStatus {
  name: string;
  root: string;
  state: "starting" | "running" | "restarting" | "failed";
  openDocuments: number;
  crashes: number;
  error?: string;
}

interface ServerEntry {
  spec: LspServerSpec;
  root: string;
  client?: LspClient;
  starting?: Promise<LspClient>;
  crashes: number;
  /** Earliest time the next start may begin after a crash. */
  restartAt?: number;
  failed?: string;
  lastError?: string;
  idleTimer?: Timer;
}

export interface AcquireOptions {
  /** `false` returns only a server that is already running. */
  start: boolean;
  signal?: AbortSignal;
}

/**
 * Owns every language server process of the runtime, shared by all threads. A server starts on first use for a
 * (server, root) pair, stops after `idleTimeoutMs` without use, and restarts after a crash with backoff; after the
 * last backoff step it reports failed until `reload()`.
 */
export class LspManager {
  private readonly entries = new Map<string, ServerEntry>();
  private readonly idleTimeoutMs: number;
  private readonly restartBackoffMs: readonly number[];
  private readonly startClient: NonNullable<LspManagerOptions["startClient"]>;

  constructor(options: LspManagerOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_LSP_IDLE_TIMEOUT_MS;
    this.restartBackoffMs = options.restartBackoffMs ?? DEFAULT_LSP_RESTART_BACKOFF_MS;
    this.startClient =
      options.startClient ?? ((spec, root, onUnexpectedExit) => LspClient.start(spec, root, { onUnexpectedExit }));
  }

  /** Root directory a file of `spec` would use. */
  rootFor(spec: LspServerSpec, filePath: string, cwd: string): string {
    return findServerRoot(filePath, spec.rootMarkers, cwd);
  }

  /**
   * The running client of `spec` at `root`, starting it when `options.start` allows. Waits out a pending crash
   * backoff. Throws when the server failed or cannot start; returns `undefined` only when `start` is false and the
   * server is not running.
   */
  async acquire(spec: LspServerSpec, root: string, options: AcquireOptions): Promise<LspClient | undefined> {
    const key = entryKey(spec, root);
    let entry = this.entries.get(key);
    if (entry?.client?.alive) {
      this.touch(entry);
      return entry.client;
    }
    if (!options.start) return undefined;
    if (!entry) {
      entry = { spec, root, crashes: 0 };
      this.entries.set(key, entry);
    }
    if (entry.failed) {
      const reason = entry.failed.replace(/\.$/, "");
      throw new Error(`${reason}. ${spec.name} stays stopped after repeated failures until the config is reloaded.`);
    }
    entry.starting ??= this.startEntry(entry);
    const client = await raceAbort(entry.starting, options.signal);
    this.touch(entry);
    return client;
  }

  private async startEntry(entry: ServerEntry): Promise<LspClient> {
    try {
      const wait = (entry.restartAt ?? 0) - Date.now();
      if (wait > 0) await Bun.sleep(wait);
      let started: LspClient | undefined;
      started = await this.startClient(entry.spec, entry.root, (reason) => {
        // An exit during startup is reported by the failed start itself.
        if (started && entry.client === started) this.onCrash(entry, reason);
      });
      entry.client = started;
      entry.lastError = undefined;
      return started;
    } catch (error) {
      this.recordCrash(entry, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      entry.starting = undefined;
    }
  }

  private onCrash(entry: ServerEntry, reason: string): void {
    entry.client = undefined;
    clearTimeout(entry.idleTimer);
    this.recordCrash(entry, reason);
  }

  private recordCrash(entry: ServerEntry, reason: string): void {
    entry.crashes += 1;
    entry.lastError = reason;
    const delay = this.restartBackoffMs[entry.crashes - 1];
    if (delay === undefined) entry.failed = reason;
    else entry.restartAt = Date.now() + delay;
    logger.warn("lsp_server_crashed", {
      message: `[lsp] ${entry.spec.name} (${entry.root}) ${reason}`,
      fields: { server: entry.spec.name, root: entry.root, crashes: entry.crashes, failed: !!entry.failed },
    });
  }

  private touch(entry: ServerEntry): void {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      const client = entry.client;
      if (!client) return;
      entry.client = undefined;
      void client.shutdown();
    }, this.idleTimeoutMs);
    entry.idleTimer.unref?.();
  }

  runningClients(): LspClient[] {
    return [...this.entries.values()].flatMap((entry) => (entry.client?.alive ? [entry.client] : []));
  }

  status(): LspServerStatus[] {
    return [...this.entries.values()].flatMap((entry): LspServerStatus[] => {
      const state: LspServerStatus["state"] | undefined = entry.failed
        ? "failed"
        : entry.starting
          ? "starting"
          : entry.client?.alive
            ? "running"
            : entry.crashes > 0
              ? "restarting"
              : undefined;
      if (!state) return [];
      return [
        {
          name: entry.spec.name,
          root: entry.root,
          state,
          openDocuments: entry.client?.openPaths().length ?? 0,
          crashes: entry.crashes,
          ...(entry.failed || entry.lastError ? { error: entry.failed ?? entry.lastError } : {}),
        },
      ];
    });
  }

  /** Stop every server and forget crash history, so a failed server may start again (config reload, host exit). */
  async shutdown(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.all(
      entries.map(async (entry) => {
        clearTimeout(entry.idleTimer);
        const client = entry.client ?? (await entry.starting?.catch(() => undefined));
        entry.client = undefined;
        await client?.shutdown();
      }),
    );
  }
}

/** A server identity includes its launch spec, so a config change starts a fresh process. */
function entryKey(spec: LspServerSpec, root: string): string {
  return JSON.stringify([spec.name, spec.command, spec.args, spec.initOptions ?? null, spec.settings ?? null, root]);
}

function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  const aborted = Promise.withResolvers<never>();
  const onAbort = () => aborted.reject(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  return Promise.race([promise, aborted.promise]).finally(() => signal.removeEventListener("abort", onAbort));
}

let singleton: LspManager | undefined;

/** Process-wide manager shared by every thread, like the MCP connection manager. */
export function getLspManager(): LspManager {
  singleton ??= new LspManager();
  return singleton;
}

/** Stop all servers when a manager exists; used by app-server shutdown and config reload. */
export async function shutdownLspManager(): Promise<void> {
  await singleton?.shutdown();
}
