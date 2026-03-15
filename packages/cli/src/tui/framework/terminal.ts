// @summary Terminal control interface for raw mode input and ANSI output
export interface TerminalOptions {
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean; isRaw?: boolean; setRawMode?(mode: boolean): void };
  stdout?: NodeJS.WritableStream & { columns?: number; rows?: number };
}

// ANSI escape sequences
const SEQ = {
  HIDE_CURSOR: "\x1b[?25l",
  SHOW_CURSOR: "\x1b[?25h",
  CLEAR_LINE: "\x1b[2K\r",
  CLEAR_TO_END: "\x1b[0J",
  KITTY_ENABLE: "\x1b[>1u",
  KITTY_DISABLE: "\x1b[<u",
  BRACKETED_PASTE_ENABLE: "\x1b[?2004h",
  BRACKETED_PASTE_DISABLE: "\x1b[?2004l",
} as const;

export class Terminal {
  private stdin: TerminalOptions["stdin"];
  private stdout: TerminalOptions["stdout"];
  private originalRawMode: boolean | undefined;
  private kittyEnabled = false;
  private bracketedPasteEnabled = false;
  private inputHandler: ((data: Buffer) => void) | null = null;
  private resizeHandler: (() => void) | null = null;

  constructor(options?: TerminalOptions) {
    this.stdin = options?.stdin ?? process.stdin;
    this.stdout = options?.stdout ?? process.stdout;
  }

  /** Enter raw mode, register handlers */
  start(onInput: (data: string) => void, onResize: () => void): void {
    const stdin = this.stdin as NodeJS.ReadStream;
    if (stdin.isTTY) {
      this.originalRawMode = stdin.isRaw;
      stdin.setRawMode?.(true);
    }
    (stdin as NodeJS.ReadableStream).resume();

    this.inputHandler = (data: Buffer) => onInput(data.toString("utf-8"));
    this.resizeHandler = onResize;
    (stdin as NodeJS.ReadableStream).on("data", this.inputHandler);
    (this.stdout as NodeJS.WritableStream).on("resize", onResize);

    // Try enabling Kitty keyboard protocol and bracketed paste mode
    this.enableKitty();
    this.enableBracketedPaste();

    // Ensure cleanup on exit
    process.on("exit", () => this.cleanup());
  }

  /** Restore terminal state */
  stop(): void {
    this.cleanup();
    const stdin = this.stdin as NodeJS.ReadStream;
    if (stdin.isTTY && this.originalRawMode !== undefined) {
      stdin.setRawMode?.(this.originalRawMode);
    }
    (stdin as NodeJS.ReadableStream).pause();
    if (this.inputHandler) {
      (stdin as NodeJS.ReadableStream).removeListener("data", this.inputHandler);
      this.inputHandler = null;
    }
    if (this.resizeHandler) {
      (this.stdout as NodeJS.WritableStream).removeListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
  }

  /** Write to stdout (raw) */
  write(data: string): void {
    (this.stdout as NodeJS.WritableStream).write(data);
  }

  /** Emit the terminal bell control character. */
  bell(): void {
    this.write("\x07");
  }

  /** Write batched render payload to stdout */
  writeSynchronized(data: string): void {
    (this.stdout as NodeJS.WritableStream).write(data);
  }

  /** Terminal dimensions */
  get columns(): number {
    return (this.stdout as { columns?: number }).columns ?? 80;
  }

  get rows(): number {
    return (this.stdout as { rows?: number }).rows ?? 24;
  }

  /** Cursor control */
  hideCursor(): void {
    this.write(SEQ.HIDE_CURSOR);
  }

  showCursor(): void {
    this.write(SEQ.SHOW_CURSOR);
  }

  moveCursorTo(row: number, col: number): void {
    this.write(`\x1b[${row + 1};${col + 1}H`);
  }

  /** Line operations */
  clearLine(): void {
    this.write(SEQ.CLEAR_LINE);
  }

  clearFromCursor(): void {
    this.write(SEQ.CLEAR_TO_END);
  }

  clearScreen(): void {
    this.write("\x1b[2J\x1b[H");
  }

  /** Move cursor up/down by N lines */
  moveBy(lines: number): void {
    if (lines > 0) {
      this.write(`\x1b[${lines}B`);
    } else if (lines < 0) {
      this.write(`\x1b[${-lines}A`);
    }
  }

  /** Whether Kitty keyboard protocol is active */
  get isKittyEnabled(): boolean {
    return this.kittyEnabled;
  }

  private enableKitty(): void {
    // Enable Kitty protocol for disambiguated key events
    // Terminals that don't support it will simply ignore this sequence
    try {
      this.write(SEQ.KITTY_ENABLE);
      this.kittyEnabled = true;
    } catch {
      this.kittyEnabled = false;
    }
  }

  private enableBracketedPaste(): void {
    try {
      this.write(SEQ.BRACKETED_PASTE_ENABLE);
      this.bracketedPasteEnabled = true;
    } catch {
      this.bracketedPasteEnabled = false;
    }
  }

  private cleanup(): void {
    if (this.bracketedPasteEnabled) {
      try {
        this.write(SEQ.BRACKETED_PASTE_DISABLE);
      } catch {
        // Ignore write errors during cleanup
      }
      this.bracketedPasteEnabled = false;
    }

    if (this.kittyEnabled) {
      try {
        this.write(SEQ.KITTY_DISABLE);
      } catch {
        // Ignore write errors during cleanup
      }
      this.kittyEnabled = false;
    }
    try {
      this.showCursor();
    } catch {
      // Ignore write errors during cleanup
    }
  }
}
