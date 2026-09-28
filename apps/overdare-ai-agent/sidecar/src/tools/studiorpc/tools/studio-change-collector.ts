// @summary Single-owner project log ingestion into bounded RAM with safe retry and timer cleanup
import { constants, realpathSync } from "node:fs";
import { lstat, open, readdir, rename, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { isStudioEditLogSourceName, parseEditLogText } from "./edit-log";
import { decodeOvdrjm } from "./ovdrjm-utils";
import { StudioChangeStore } from "./studio-change-store";

export interface StudioChangeSourceFile {
  path: string;
  identity: string;
  bytes: number;
  modifiedMs: number;
}
export interface StudioChangeCollectorLimits {
  maxFileBytes: number;
  maxBacklogBytes: number;
  maxRetryEntries: number;
  maxFilesPerPoll: number;
}
export interface StudioChangeSourceIo {
  list(cwd: string): Promise<StudioChangeSourceFile[]>;
  rotate(path: string): Promise<StudioChangeSourceFile>;
  read(path: string): Promise<Buffer>;
  remove(path: string): Promise<void>;
}
export interface StudioChangeCollectorOptions {
  store?: StudioChangeStore;
  limits?: Partial<StudioChangeCollectorLimits>;
  io?: StudioChangeSourceIo;
  schedule?: (tick: () => void, intervalMs: number) => () => void;
}

let rotation = 0;
export function createStudioChangeSourceIo(cwd: string, maxFileBytes: number): StudioChangeSourceIo {
  const directory = resolve(cwd);
  const validate = (path: string) => {
    if (dirname(resolve(path)) !== directory || !isStudioEditLogSourceName(basename(path))) {
      throw new Error("Unrecognized Studio source path");
    }
  };
  const describe = async (path: string): Promise<StudioChangeSourceFile> => {
    validate(path);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Studio source is not a regular file");
    return {
      path,
      bytes: stat.size,
      identity: `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`,
      modifiedMs: stat.mtimeMs,
    };
  };
  return {
    async list() {
      let names: string[];
      try {
        names = await readdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      const files: StudioChangeSourceFile[] = [];
      for (const name of names) {
        if (!isStudioEditLogSourceName(name)) continue;
        const path = join(directory, name);
        const stat = await lstat(path);
        if (stat.isFile() && !stat.isSymbolicLink()) files.push(await describe(path));
      }
      return files.sort((a, b) => a.modifiedMs - b.modifiedMs || a.path.localeCompare(b.path));
    },
    async rotate(path) {
      await describe(path);
      const target = `${path}.${Date.now().toString(36)}-${rotation++}.consuming`;
      await rename(path, target);
      return describe(target);
    },
    async read(path) {
      await describe(path);
      const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const buffer = Buffer.alloc(Math.min((await file.stat()).size, maxFileBytes + 1));
        let offset = 0;
        while (offset < buffer.length) {
          const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
          if (!bytesRead) break;
          offset += bytesRead;
        }
        if ((await file.stat()).size !== offset && offset <= maxFileBytes) {
          throw new Error("Studio source changed while being read; retry required");
        }
        return buffer.subarray(0, offset);
      } finally {
        await file.close();
      }
    },
    async remove(path) {
      await describe(path);
      await unlink(path);
    },
  };
}

interface RetryState {
  identity: string;
  offset: number;
  complete: boolean;
  bytes?: number;
  modifiedMs?: number;
}

export class StudioChangeCollector {
  readonly store: StudioChangeStore;
  private readonly limits: StudioChangeCollectorLimits;
  private readonly io: StudioChangeSourceIo;
  private readonly retries = new Map<string, RetryState>();
  private readonly schedule: NonNullable<StudioChangeCollectorOptions["schedule"]>;
  private cancelTimer?: () => void;
  private running?: Promise<void>;
  private stopped = false;
  private lastError?: string;

  constructor(
    private readonly cwd: string,
    options: StudioChangeCollectorOptions = {},
  ) {
    this.store = options.store ?? new StudioChangeStore();
    this.limits = {
      maxFileBytes: 8 * 1024 * 1024,
      maxBacklogBytes: 64 * 1024 * 1024,
      maxRetryEntries: 256,
      maxFilesPerPoll: 4,
      ...options.limits,
    };
    for (const limit of Object.values(this.limits)) {
      if (!Number.isSafeInteger(limit) || limit < 1)
        throw new Error("Studio collector limits must be positive integers");
    }
    this.io = options.io ?? createStudioChangeSourceIo(cwd, this.limits.maxFileBytes);
    this.schedule =
      options.schedule ??
      ((tick, intervalMs) => {
        const timer = setInterval(tick, intervalMs);
        timer.unref?.();
        return () => clearInterval(timer);
      });
  }

  start(): void {
    if (this.stopped || this.cancelTimer) return;
    this.cancelTimer = this.schedule(() => {
      void this.refresh();
    }, 1000);
    void this.refresh();
  }

  refresh(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    const running = this.poll().catch((error) => this.report(error));
    this.running = running;
    void running.finally(() => {
      if (this.running === running) this.running = undefined;
    });
    return running;
  }

  private report(error: unknown): void {
    const message = String(error instanceof Error ? error.message : error).slice(0, 800);
    if (message === this.lastError) return;
    this.lastError = message;
    this.store.recordGap(
      `Studio change collection failed: ${message}. Inspect current Studio state; source files will be retried.`,
    );
  }

  private async poll(): Promise<void> {
    const files = await this.io.list(this.cwd);
    const present = new Set(files.map((file) => file.path));
    for (const path of this.retries.keys()) if (!present.has(path)) this.retries.delete(path);
    let backlog = files.reduce((sum, file) => sum + file.bytes, 0);
    let processed = 0;
    for (let source of files) {
      if (processed >= this.limits.maxFilesPerPoll) break;
      const cached = this.retries.get(source.path);
      if (
        cached &&
        !cached.complete &&
        cached.identity === source.identity &&
        cached.bytes === source.bytes &&
        cached.modifiedMs === source.modifiedMs &&
        backlog <= this.limits.maxBacklogBytes &&
        source.bytes <= this.limits.maxFileBytes
      )
        continue;
      if (!this.retries.has(source.path) && this.retries.size >= this.limits.maxRetryEntries) continue;
      processed++;
      try {
        if (basename(source.path).toLowerCase() === "edit.log") source = await this.io.rotate(source.path);
        let state = this.retries.get(source.path);
        if (!state || state.identity !== source.identity) {
          state = { identity: source.identity, offset: 0, complete: false };
          this.retries.set(source.path, state);
        }
        if (!state.complete && (source.bytes > this.limits.maxFileBytes || backlog > this.limits.maxBacklogBytes)) {
          this.store.recordGap(
            "Studio source file or backlog exceeds its absolute size limit. History was discarded; inspect current Studio state.",
          );
          state.complete = true;
        }
        if (!state.complete) {
          const buffer = await this.io.read(source.path);
          if (buffer.length > this.limits.maxFileBytes) {
            this.store.recordGap("Oversized Studio source was discarded. Inspect current Studio state.");
            state.complete = true;
          } else {
            const utf16Tail = buffer[0] === 0xff && buffer[1] === 0xfe && buffer.length % 2 !== 0;
            const text = decodeOvdrjm(utf16Tail ? buffer.subarray(0, -1) : buffer);
            if (text.length < state.offset) {
              this.store.recordGap("A rotated Studio source was truncated. Inspect current Studio state.");
              state.offset = 0;
            }
            const parsed = parseEditLogText(text.slice(state.offset));
            this.store.append(parsed.envelopes);
            if (parsed.failures)
              this.store.recordGap(
                `${parsed.failures} malformed Studio edit records were skipped. Inspect current Studio state.`,
              );
            state.offset += parsed.consumedChars;
            state.complete = !parsed.incomplete && !utf16Tail;
            state.bytes = buffer.length;
            state.modifiedMs = source.modifiedMs;
          }
        }
        if (state.complete) {
          await this.io.remove(source.path);
          this.retries.delete(source.path);
          backlog -= source.bytes;
        }
        this.lastError = undefined;
      } catch (error) {
        this.report(error);
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    await this.running;
    this.retries.clear();
  }
}

const collectors = new Map<string, StudioChangeCollector>();
function projectKey(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return resolve(cwd);
  }
}
export function getStudioChangeCollector(cwd: string): StudioChangeCollector {
  const key = projectKey(cwd);
  let collector = collectors.get(key);
  if (!collector) {
    collector = new StudioChangeCollector(key);
    collectors.set(key, collector);
  }
  return collector;
}
export async function stopStudioChangeCollector(cwd: string): Promise<void> {
  const key = projectKey(cwd);
  const collector = collectors.get(key);
  if (!collector) return;
  await collector.stop();
  if (collectors.get(key) === collector) collectors.delete(key);
}
