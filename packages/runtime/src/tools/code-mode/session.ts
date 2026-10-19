// @summary Code mode session: owns exec cells (Bun Workers), the cross-exec store, and nested tool dispatch

import type { ImageBlock } from "@diligent/core/message-contract";
import type { ToolContext, ToolOutputFileStore, ToolRegistry } from "@diligent/core/tool-contract";
import { executeTool } from "@diligent/core/tool-contract";
import { SUPPORTED_IMAGE_MEDIA_TYPES, type SupportedImageMediaType } from "@diligent/protocol";
import { type CodeModeHostMessage, type CodeModeWorkerMessage, codeModeWorkerMain } from "./worker";

/** Live (yielded) cells kept per session; starting another evicts the least recently driven one. */
const MAX_LIVE_CELLS = 8;
/** Nested outputs are persisted in the parent result for history rendering only, so they are capped. */
const MAX_PERSISTED_NESTED_OUTPUT_CHARS = 8_000;
/**
 * When the yield deadline passes during a nested call, the script usually finishes right after that call
 * returns. Waiting briefly avoids an empty "running" result followed by an exec_wait that only collects it.
 */
const POST_NESTED_CALL_GRACE_MS = 500;

/** The tool call currently awaiting a cell (`exec` or `exec_wait`); nested calls run under its context. */
export interface CodeModeDriver {
  ctx: ToolContext;
  /** Tools callable from the guest `tools` object, keyed by catalog name. */
  registry: ToolRegistry;
  outputStore?: ToolOutputFileStore;
}

/** One nested call, persisted in the driving call's result metadata so history can rebuild nested items. */
export interface CodeModeNestedCallRecord {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output: string;
  isError: boolean;
  startedAt: number;
  durationMs: number;
}

export type CodeModeCellStatus = "running" | "completed" | "failed" | "terminated";

/** Output accumulated since the previous yield, plus the cell state when the driver detached. */
export interface CodeModeCellSnapshot {
  cellId: string;
  status: CodeModeCellStatus;
  texts: string[];
  images: ImageBlock[];
  error?: string;
  nestedCalls: CodeModeNestedCallRecord[];
}

export interface CodeModeToolBinding {
  /** JavaScript identifier on the guest `tools` object. */
  globalName: string;
  name: string;
  description: string;
}

interface ActiveDriver extends CodeModeDriver {
  dispatching: boolean;
  nextNestedIndex: number;
}

interface PendingToolCall {
  id: number;
  name: string;
  input: unknown;
}

let workerUrl: string | undefined;

function createWorker(): Worker {
  workerUrl ??= URL.createObjectURL(
    new Blob([`(${codeModeWorkerMain.toString()})()`], { type: "application/javascript" }),
  );
  const worker = new Worker(workerUrl);
  // Yielded cells may idle across turns; they must not keep the host process alive.
  // Bun implements Worker#unref, but its types resolve to the DOM Worker declaration.
  (worker as Worker & { unref(): void }).unref();
  return worker;
}

/**
 * Reader/writer gate mirroring the agent loop's batching rule: tools marked `supportParallel` may overlap,
 * every other tool runs alone.
 */
class NestedToolGate {
  private lastExclusive: Promise<void> = Promise.resolve();
  private sharedSinceExclusive: Promise<void>[] = [];

  async acquire(shared: boolean): Promise<() => void> {
    const { promise: held, resolve: release } = Promise.withResolvers<void>();
    let gate: Promise<unknown>;
    if (shared) {
      gate = this.lastExclusive;
      this.sharedSinceExclusive.push(held);
    } else {
      gate = Promise.all([this.lastExclusive, ...this.sharedSinceExclusive]);
      this.lastExclusive = held;
      this.sharedSinceExclusive = [];
    }
    await gate;
    return release;
  }
}

class CodeModeCell {
  status: CodeModeCellStatus = "running";
  lastDrivenAt = Date.now();
  private readonly worker = createWorker();
  private readonly gate = new NestedToolGate();
  private readonly queue: PendingToolCall[] = [];
  private readonly inFlight = new Map<number, { controller: AbortController; settled: Promise<void> }>();
  private texts: string[] = [];
  private images: ImageBlock[] = [];
  private nestedCalls: CodeModeNestedCallRecord[] = [];
  private error: string | undefined;
  private driver: ActiveDriver | undefined;
  private yieldRequested = false;
  private wake: (() => void) | undefined;

  constructor(
    readonly id: string,
    code: string,
    tools: CodeModeToolBinding[],
    private readonly store: Map<string, string>,
  ) {
    this.worker.onmessage = (event: MessageEvent<CodeModeWorkerMessage>) => this.handleMessage(event.data);
    this.worker.onerror = (event) => this.finish("failed", event.message || "exec worker crashed");
    this.post({ type: "start", code, tools, store: Object.fromEntries(store) });
  }

  get isDriven(): boolean {
    return this.driver !== undefined;
  }

  /**
   * Runs the cell under `driver` until it finishes, yields (`yield_control()` or `yieldTimeMs`), or the
   * driver aborts. On yield, in-flight nested calls finish under this driver; later calls queue for the next one.
   */
  async drive(driver: CodeModeDriver, yieldTimeMs: number): Promise<CodeModeCellSnapshot> {
    const active: ActiveDriver = { ...driver, dispatching: true, nextNestedIndex: 0 };
    this.driver = active;
    this.lastDrivenAt = Date.now();
    this.yieldRequested = false;
    const onAbort = () => this.terminate();
    driver.ctx.signal.addEventListener("abort", onAbort, { once: true });
    if (driver.ctx.signal.aborted) this.terminate();
    try {
      for (const call of this.queue.splice(0)) this.dispatch(call, active);
      const deadline = Date.now() + yieldTimeMs;
      while (this.status === "running" && !this.yieldRequested && Date.now() < deadline) {
        await this.waitForChange(deadline - Date.now());
      }
      active.dispatching = false;
      const settling = [...this.inFlight.values()];
      if (this.status === "completed" || this.status === "failed") {
        // Like an ended isolate, a finished script discards its unawaited nested calls.
        for (const call of settling) call.controller.abort();
      }
      if (this.status !== "terminated") await Promise.all(settling.map((call) => call.settled));
      if (this.status === "running" && !this.yieldRequested && settling.length > 0) {
        await this.waitForChange(POST_NESTED_CALL_GRACE_MS);
      }
    } finally {
      driver.ctx.signal.removeEventListener("abort", onAbort);
      this.driver = undefined;
      this.lastDrivenAt = Date.now();
    }
    return this.takeSnapshot();
  }

  terminate(): void {
    this.finish("terminated");
  }

  private takeSnapshot(): CodeModeCellSnapshot {
    const snapshot: CodeModeCellSnapshot = {
      cellId: this.id,
      status: this.status,
      texts: this.texts,
      images: this.images,
      nestedCalls: this.nestedCalls,
      ...(this.error !== undefined ? { error: this.error } : {}),
    };
    this.texts = [];
    this.images = [];
    this.nestedCalls = [];
    return snapshot;
  }

  private waitForChange(timeoutMs: number): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    const timer = setTimeout(() => this.notify(), Math.max(0, timeoutMs));
    this.wake = () => {
      clearTimeout(timer);
      resolve();
    };
    return promise;
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }

  private finish(status: Exclude<CodeModeCellStatus, "running">, error?: string): void {
    if (this.status !== "running") return;
    this.status = status;
    this.error = error;
    this.worker.terminate();
    this.notify();
  }

  private post(message: CodeModeHostMessage): void {
    if (this.status === "running") this.worker.postMessage(message);
  }

  private handleMessage(message: CodeModeWorkerMessage): void {
    if (this.status !== "running") return;
    switch (message.type) {
      case "tool_call":
        if (this.driver?.dispatching) this.dispatch(message, this.driver);
        else this.queue.push(message);
        return;
      case "text":
        this.texts.push(message.text);
        return;
      case "image": {
        const image = parseImageDataUrl(message.imageUrl);
        if (image) this.images.push(image);
        else
          this.texts.push(
            `[image() ignored: expected a base64 data: URL with one of ${SUPPORTED_IMAGE_MEDIA_TYPES.join(", ")}]`,
          );
        return;
      }
      case "store":
        this.store.set(message.key, message.value);
        return;
      case "yield":
        this.yieldRequested = true;
        this.notify();
        return;
      case "done":
        this.finish(message.error === undefined ? "completed" : "failed", message.error);
        return;
    }
  }

  private dispatch(call: PendingToolCall, driver: ActiveDriver): void {
    const controller = new AbortController();
    const settled = this.runNestedCall(call, driver, controller.signal).finally(() => {
      this.inFlight.delete(call.id);
      this.notify();
    });
    this.inFlight.set(call.id, { controller, settled });
  }

  private async runNestedCall(call: PendingToolCall, driver: ActiveDriver, cancel: AbortSignal): Promise<void> {
    const { ctx, registry } = driver;
    const toolCallId = `${ctx.toolCallId}#${++driver.nextNestedIndex}`;
    const itemId = `tool:${toolCallId}`;
    const release = await this.gate.acquire(registry.get(call.name)?.supportParallel === true);
    const startedAt = Date.now();
    try {
      ctx.emitNestedToolEvent?.({ type: "tool_start", itemId, toolCallId, toolName: call.name, input: call.input });
      const result = await executeTool(
        registry,
        { type: "tool_call", id: toolCallId, name: call.name, input: call.input as Record<string, unknown> },
        {
          toolCallId,
          sessionId: ctx.sessionId,
          signal: AbortSignal.any([ctx.signal, cancel]),
          // Rejected approvals end the whole turn, exactly as for a direct call.
          abort: ctx.abort,
          onUpdate: (partialResult) =>
            ctx.emitNestedToolEvent?.({ type: "tool_update", itemId, toolCallId, toolName: call.name, partialResult }),
        },
        { outputStore: driver.outputStore },
      );
      const isError = !!result.metadata?.error;
      ctx.emitNestedToolEvent?.({
        type: "tool_end",
        itemId,
        toolCallId,
        toolName: call.name,
        output: result.output,
        outputImages: result.outputImages,
        isError,
        render: result.render,
        metadata: result.metadata,
      });
      this.nestedCalls.push({
        toolCallId,
        toolName: call.name,
        input: call.input,
        output:
          result.output.length > MAX_PERSISTED_NESTED_OUTPUT_CHARS
            ? `${result.output.slice(0, MAX_PERSISTED_NESTED_OUTPUT_CHARS)}\n…[truncated for history]`
            : result.output,
        isError,
        startedAt,
        durationMs: Date.now() - startedAt,
      });
      this.post(
        isError
          ? { type: "tool_result", id: call.id, ok: false, error: `${call.name} failed: ${result.output}` }
          : { type: "tool_result", id: call.id, ok: true, value: result.output },
      );
    } finally {
      release();
    }
  }
}

function parseImageDataUrl(imageUrl: string): ImageBlock | undefined {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(imageUrl.trim());
  if (!match) return undefined;
  const mediaType = match[1].toLowerCase() as SupportedImageMediaType;
  if (!SUPPORTED_IMAGE_MEDIA_TYPES.includes(mediaType)) return undefined;
  return { type: "image", source: { type: "base64", media_type: mediaType, data: match[2] } };
}

/**
 * Per-agent code mode state. Cells outlive a single `exec` call (they can yield and be resumed with
 * `exec_wait`), and `store()` values persist across cells for the agent's lifetime.
 */
export class CodeModeSession {
  private readonly cells = new Map<string, CodeModeCell>();
  private readonly store = new Map<string, string>();
  private nextCellId = 1;

  async exec(
    code: string,
    tools: CodeModeToolBinding[],
    driver: CodeModeDriver,
    yieldTimeMs: number,
  ): Promise<CodeModeCellSnapshot> {
    this.evictIdleCells();
    const cell = new CodeModeCell(String(this.nextCellId++), code, tools, this.store);
    this.cells.set(cell.id, cell);
    return this.settle(cell, await cell.drive(driver, yieldTimeMs));
  }

  /** Resumes a yielded cell. Returns undefined for unknown or already-closed cell ids. */
  async wait(
    cellId: string,
    driver: CodeModeDriver,
    options: { yieldTimeMs: number; terminate: boolean },
  ): Promise<CodeModeCellSnapshot | undefined> {
    const cell = this.cells.get(cellId);
    if (!cell) return undefined;
    if (cell.isDriven) throw new Error(`exec cell ${cellId} is already being awaited by another call`);
    if (options.terminate) cell.terminate();
    return this.settle(cell, await cell.drive(driver, options.terminate ? 0 : options.yieldTimeMs));
  }

  /** Terminates every live cell (agent disposal). */
  dispose(): void {
    for (const cell of this.cells.values()) cell.terminate();
    this.cells.clear();
  }

  private settle(cell: CodeModeCell, snapshot: CodeModeCellSnapshot): CodeModeCellSnapshot {
    if (snapshot.status !== "running") this.cells.delete(cell.id);
    return snapshot;
  }

  private evictIdleCells(): void {
    const idle = [...this.cells.values()]
      .filter((cell) => !cell.isDriven)
      .sort((left, right) => left.lastDrivenAt - right.lastDrivenAt);
    while (this.cells.size >= MAX_LIVE_CELLS && idle.length > 0) {
      const cell = idle.shift()!;
      cell.terminate();
      this.cells.delete(cell.id);
    }
  }
}
