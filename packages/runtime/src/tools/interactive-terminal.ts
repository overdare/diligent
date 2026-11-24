// @summary Ephemeral, client-only I/O for a Bash PTY; bytes never enter a tool result
import type { ThreadTerminalParams, ThreadTerminalResponse } from "@diligent/protocol";
import type { SpawnOptions, TerminalChild, TerminalSpawner } from "../util/process";

const OUTPUT_LIMIT = 128 * 1024;

export class InteractiveTerminal {
  readonly exited: Promise<number>;
  private readonly controller = new AbortController();
  private readonly child: TerminalChild;
  private closed = false;
  private cursor = 0;
  private output = "";

  constructor(
    readonly connectionId: string,
    readonly sessionId: string,
    argv: string[],
    options: Pick<SpawnOptions, "cwd" | "env" | "signal"> & { onExit?: () => void },
    spawnTerminal: TerminalSpawner,
  ) {
    const decoder = new TextDecoder();
    const append = (value: string) => {
      this.cursor += value.length;
      this.output = (this.output + value).slice(-OUTPUT_LIMIT);
    };
    this.child = spawnTerminal(argv, {
      ...options,
      signal: options.signal ? AbortSignal.any([options.signal, this.controller.signal]) : this.controller.signal,
      cleanupGroupOnExit: true,
      onData: (bytes) => append(decoder.decode(bytes, { stream: true })),
    });
    this.exited = this.child.exited.finally(() => {
      append(decoder.decode());
      this.closed = true;
    });
  }

  stop(): void {
    this.controller.abort();
  }

  exchange({ cursor, input, cancel }: ThreadTerminalParams): ThreadTerminalResponse {
    if (cancel) this.stop();
    if (input !== undefined && (this.closed || this.controller.signal.aborted || !this.child.write(input))) {
      throw new Error("Terminal input is closed");
    }
    if (input !== undefined || cancel) {
      return { state: this.closed ? "closed" : "running", cursor, output: "", reset: false };
    }
    const first = this.cursor - this.output.length;
    const reset = cursor < first || cursor > this.cursor;
    return {
      state: this.closed ? "closed" : "running",
      cursor: this.cursor,
      output: reset ? this.output : this.output.slice(cursor - first),
      reset,
      ...(this.child.backend ? { backend: this.child.backend } : {}),
    };
  }
}
