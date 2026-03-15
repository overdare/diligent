// @summary Test-only terminal adapter that captures output to an in-memory buffer instead of process.stdout
import type { Terminal } from "./terminal";

/**
 * A drop-in replacement for Terminal that writes to an in-memory buffer.
 * Instantiate with App (or TUIRenderer) in tests to avoid global process.stdout
 * races — read `output` to assert on rendered content.
 */
export class TestTerminal {
  private buffer: string[] = [];
  private _columns: number;
  private _rows: number;
  private _kittyEnabled = false;
  private inputHandler: ((data: string) => void) | null = null;
  private resizeHandler: (() => void) | null = null;

  constructor(options?: { columns?: number; rows?: number }) {
    this._columns = options?.columns ?? 80;
    this._rows = options?.rows ?? 24;
  }

  // -------------------------------------------------------------------
  // Terminal interface implementation
  // -------------------------------------------------------------------

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.inputHandler = onInput;
    this.resizeHandler = onResize;
  }

  stop(): void {
    this.inputHandler = null;
    this.resizeHandler = null;
  }

  write(data: string): void {
    this.buffer.push(data);
  }

  bell(): void {
    this.buffer.push("\x07");
  }

  writeSynchronized(data: string): void {
    this.buffer.push(data);
  }

  get columns(): number {
    return this._columns;
  }

  get rows(): number {
    return this._rows;
  }

  hideCursor(): void {
    this.buffer.push("\x1b[?25l");
  }

  showCursor(): void {
    this.buffer.push("\x1b[?25h");
  }

  moveCursorTo(row: number, col: number): void {
    this.buffer.push(`\x1b[${row + 1};${col + 1}H`);
  }

  clearLine(): void {
    this.buffer.push("\x1b[2K\r");
  }

  clearFromCursor(): void {
    this.buffer.push("\x1b[0J");
  }

  clearScreen(): void {
    this.buffer.push("\x1b[2J\x1b[H");
  }

  moveBy(lines: number): void {
    if (lines > 0) {
      this.buffer.push(`\x1b[${lines}B`);
    } else if (lines < 0) {
      this.buffer.push(`\x1b[${-lines}A`);
    }
  }

  get isKittyEnabled(): boolean {
    return this._kittyEnabled;
  }

  // -------------------------------------------------------------------
  // Test helpers
  // -------------------------------------------------------------------

  /** Full concatenated output written since last reset */
  get output(): string {
    return this.buffer.join("");
  }

  /** Clear captured output and reset the buffer */
  clearOutput(): void {
    this.buffer = [];
  }

  /** Simulate terminal resize */
  resize(columns: number, rows: number): void {
    this._columns = columns;
    this._rows = rows;
    this.resizeHandler?.();
  }

  /** Simulate key input */
  simulateInput(data: string): void {
    this.inputHandler?.(data);
  }
}

// Verify structural compatibility with Terminal at compile time.
// If Terminal's interface changes, this will produce a type error here.
type _AssertCompatible =
  TestTerminal extends Pick<
    Terminal,
    | "start"
    | "stop"
    | "write"
    | "bell"
    | "writeSynchronized"
    | "columns"
    | "rows"
    | "hideCursor"
    | "showCursor"
    | "moveCursorTo"
    | "clearLine"
    | "clearFromCursor"
    | "clearScreen"
    | "moveBy"
    | "isKittyEnabled"
  >
    ? true
    : false;
const _check: _AssertCompatible = true;
void _check;
