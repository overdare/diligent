// @summary Keep resets and geometry changes behind xterm's asynchronous output parser.
interface RenderTerminal {
  write(data: string | Uint8Array, callback?: () => void): void;
  reset(): void;
  resize(cols: number, rows: number): void;
}

export class TerminalRenderer {
  private blocked = false;
  private disposed = false;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly terminal: RenderTerminal) {}

  write(data: string | Uint8Array): void {
    this.enqueue(() => this.terminal.write(data));
  }

  reset(cols: number, rows: number): void {
    this.afterWrite(() => {
      this.terminal.reset();
      this.terminal.resize(cols, rows);
    });
  }

  resize(cols: number, rows: number): void {
    this.afterWrite(() => this.terminal.resize(cols, rows));
  }

  afterWrite(callback: () => void): void {
    this.enqueue(() => {
      this.blocked = true;
      this.terminal.write("", () => {
        if (this.disposed) return;
        callback();
        this.blocked = false;
        this.flush();
      });
    });
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
  }

  private enqueue(operation: () => void): void {
    if (this.disposed) return;
    this.queue.push(operation);
    this.flush();
  }

  private flush(): void {
    // Ordinary writes stay batched by xterm. Only a state boundary waits for parsing;
    // serially waiting for every output frame would add latency during large redraws.
    while (!this.blocked && !this.disposed && this.queue.length) this.queue.shift()!();
  }
}
