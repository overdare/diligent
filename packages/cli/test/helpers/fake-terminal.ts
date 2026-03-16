// @summary Test helpers for isolated TUI stdin/stdout streams without mutating global process IO
import { EventEmitter } from "node:events";

interface FakeWriteStream extends NodeJS.WritableStream {
  columns?: number;
  rows?: number;
  writes: string[];
  write(
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    cb?: (error?: Error | null) => void,
  ): boolean;
}

interface FakeReadStream extends NodeJS.ReadableStream {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?(mode: boolean): void;
  emit(event: "data", chunk: Buffer): boolean;
}

class FakeReadable extends EventEmitter implements FakeReadStream {
  isTTY = true;
  isRaw = false;

  setRawMode(mode: boolean): void {
    this.isRaw = mode;
  }

  resume(): this {
    return this;
  }

  pause(): this {
    return this;
  }
}

class FakeWritable extends EventEmitter implements FakeWriteStream {
  columns = 120;
  rows = 40;
  writes: string[] = [];
  isTTY = true;

  write(
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error?: Error | null) => void),
    cb?: (error?: Error | null) => void,
  ): boolean {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
    this.writes.push(text);
    const callback = typeof encoding === "function" ? encoding : cb;
    callback?.(null);
    return true;
  }
}

export interface FakeTerminalHarness {
  stdin: FakeReadStream;
  stdout: FakeWriteStream;
  emitText: (text: string) => void;
  emitEnter: () => void;
  emitCtrlC: () => void;
  emitCtrlO: () => void;
}

export function createFakeTerminalHarness(): FakeTerminalHarness {
  const stdin = new FakeReadable();
  const stdout = new FakeWritable();

  const emitChar = (ch: string) => {
    stdin.emit("data", Buffer.from(ch, "utf-8"));
  };

  return {
    stdin,
    stdout,
    emitText(text: string) {
      for (const ch of text) {
        emitChar(ch);
      }
    },
    emitEnter() {
      stdin.emit("data", Buffer.from("\r"));
    },
    emitCtrlC() {
      stdin.emit("data", Buffer.from("\x03"));
    },
    emitCtrlO() {
      stdin.emit("data", Buffer.from("\x0f"));
    },
  };
}
