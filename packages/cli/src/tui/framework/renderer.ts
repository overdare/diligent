// @summary Renders components to the terminal with diff-based updates
import { Container } from "./container";
import { debugLogger } from "./debug-logger";
import { charDisplayWidth, displayWidth } from "./string-width";
import type { Terminal } from "./terminal";
import type { Component, Focusable, RenderBlock } from "./types";
import { CURSOR_MARKER } from "./types";

/** Strip ANSI escape codes for measuring visible width */
const ANSI_RE = new RegExp(`${String.fromCharCode(0x1b)}\\[[0-9;]*[a-zA-Z]`, "g");
const ANSI_PRIVATE_RE = new RegExp(`${String.fromCharCode(0x1b)}\\[\\?[0-9;]*[a-zA-Z]`, "g");
function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, "").replace(ANSI_PRIVATE_RE, "");
}

/**
 * TUI renderer using inline viewport — content is written to the normal terminal
 * buffer, and each render rewinds to the start of the previous frame before
 * overwriting.  No alternate screen is used, so the terminal's native scrollback
 * and text-selection features remain available.
 */
export class TUIRenderer {
  private static readonly DEFAULT_MAX_FPS = 30;
  private static readonly OVERFLOW_FLUSH_INTERVAL_MS = 40;
  private renderScheduled = false;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRenderAt = 0;
  private lastOverflowFlushAt = 0;
  private readonly minRenderIntervalMs: number;
  private focusedComponent: (Component & Focusable) | null = null;
  private started = false;
  private pendingHistoryLines: string[] = [];
  private persistentFlushedCounts = new Map<string, number>();
  private overflowFlushedCounts = new Map<string, number>();
  private lastActiveRows = 0; // terminal rows occupied by previous active region
  private lastCursorRowInActive = 0; // cursor row within active region (for rewind)

  constructor(
    private terminal: Terminal,
    private root: Component,
  ) {
    this.minRenderIntervalMs = this.resolveMinRenderIntervalMs();
  }

  /** Schedule a render on next tick (coalesces multiple requests) */
  requestRender(): void {
    if (this.renderScheduled || !this.started) return;
    this.renderScheduled = true;

    const elapsed = Date.now() - this.lastRenderAt;
    const delay = Math.max(0, this.minRenderIntervalMs - elapsed);
    const runRender = () => {
      this.renderScheduled = false;
      this.renderTimer = null;
      if (this.started) {
        this.doRender();
      }
    };

    if (delay === 0) {
      queueMicrotask(runRender);
      return;
    }

    this.renderTimer = setTimeout(runRender, delay);
  }

  /** Force an immediate render */
  forceRender(): void {
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = null;
      this.renderScheduled = false;
    }
    if (this.started) {
      this.doRender();
    }
  }

  /** Insert finalized transcript lines into terminal history before the next active redraw. */
  insertHistoryLines(lines: string[]): void {
    if (lines.length === 0) {
      return;
    }
    this.pendingHistoryLines.push(...lines);
    if (this.started) {
      this.forceRender();
    }
  }

  /** Set which component receives hardware cursor focus */
  setFocus(component: (Component & Focusable) | null): void {
    if (this.focusedComponent) {
      this.focusedComponent.focused = false;
    }
    this.focusedComponent = component;
    if (component) {
      component.focused = true;
    }
  }

  /** Start the render loop */
  start(): void {
    this.started = true;
    this.terminal.hideCursor();
    this.doRender();
  }

  /** Reset committed/active bookkeeping, typically before full-screen clears. */
  resetFrameState(): void {
    this.pendingHistoryLines = [];
    this.persistentFlushedCounts.clear();
    this.overflowFlushedCounts.clear();
    this.lastActiveRows = 0;
    this.lastCursorRowInActive = 0;
  }

  /** Stop rendering — clear active region, leave committed lines in scrollback */
  stop(): void {
    this.started = false;
    this.renderScheduled = false;
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
    // Erase active region so only committed lines remain in scrollback
    if (this.lastActiveRows > 0) {
      this.clearPreviousActiveRegion();
    }
    this.resetFrameState();
    this.terminal.showCursor();
  }

  private clearPreviousActiveRegion(): void {
    if (this.lastActiveRows <= 0) return;

    // Rewind from current cursor position (within active region) back to the
    // first physical row of the previous active frame.
    this.terminal.write("\r");
    if (this.lastCursorRowInActive > 0) {
      this.terminal.write(`\x1b[${this.lastCursorRowInActive}A`);
    }

    // Clear only rows that belonged to the previous active region instead of
    // clearing to end-of-screen, which causes visible terminal chrome flicker.
    for (let i = 0; i < this.lastActiveRows; i++) {
      this.terminal.write("\x1b[2K\r");
      if (i < this.lastActiveRows - 1) {
        this.terminal.write("\x1b[1B");
      }
    }

    // Return cursor to the top row where the next active frame will be drawn.
    if (this.lastActiveRows > 1) {
      this.terminal.write(`\x1b[${this.lastActiveRows - 1}A`);
    }
    this.terminal.write("\r");
  }

  /** Count how many terminal rows a single line occupies given terminal width */
  private countTerminalRowsForLine(line: string, width: number): number {
    const safeWidth = Math.max(1, width);
    const visible = displayWidth(stripAnsi(line));
    return Math.max(1, Math.ceil(visible / safeWidth));
  }

  private hasBoundaryCarry(line: string, width: number): boolean {
    const safeWidth = Math.max(1, width);
    const visible = displayWidth(stripAnsi(line));
    return visible > 0 && visible % safeWidth === 0;
  }

  private serializeLinesForTerminal(lines: string[], width: number, ensureTrailingNewline = false): string {
    if (lines.length === 0) {
      return "";
    }

    const safeWidth = Math.max(1, width);
    let out = "";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      out += line;
      const isLast = i === lines.length - 1;
      if (!isLast) {
        if (!this.hasBoundaryCarry(line, safeWidth)) {
          out += "\r\n";
        }
      } else if (ensureTrailingNewline && !this.hasBoundaryCarry(line, safeWidth)) {
        out += "\r\n";
      }
    }

    return out;
  }

  /** Count physical terminal rows consumed, including boundary auto-wrap carry rows. */
  private countPhysicalTerminalRows(lines: string[], width: number): number {
    const safeWidth = Math.max(1, width);
    return lines.reduce((sum, line) => {
      const baseRows = this.countTerminalRowsForLine(line, safeWidth);
      const boundaryCarry = this.hasBoundaryCarry(line, safeWidth) ? 1 : 0;
      return sum + baseRows + boundaryCarry;
    }, 0);
  }

  /** Keep only the suffix of lines that fits within the terminal's visible row budget */
  private truncateLineToFitRowsFromEnd(line: string, width: number, maxRows: number): string {
    if (maxRows <= 0) {
      return "";
    }

    const safeWidth = Math.max(1, width);
    const visible = displayWidth(stripAnsi(line));
    const maxVisible = Math.max(0, maxRows * safeWidth - 1);
    if (visible <= maxVisible) {
      return line;
    }

    const startCol = Math.max(0, visible - maxVisible);
    return this.sliceWithAnsi(line, startCol, visible);
  }

  private sliceLinesToTerminalRows(
    lines: string[],
    width: number,
    maxRows: number,
  ): { lines: string[]; startIdx: number } {
    if (maxRows <= 0 || lines.length === 0) {
      return { lines: [], startIdx: lines.length };
    }

    const safeWidth = Math.max(1, width);
    let usedRows = 0;
    let startIdx = lines.length;
    for (let i = lines.length - 1; i >= 0; i--) {
      const baseRows = this.countTerminalRowsForLine(lines[i], safeWidth);
      const boundaryCarry = this.hasBoundaryCarry(lines[i], safeWidth) ? 1 : 0;
      const lineRows = baseRows + boundaryCarry;
      if (usedRows + lineRows > maxRows) {
        break;
      }
      usedRows += lineRows;
      startIdx = i;
    }

    if (startIdx === lines.length) {
      const lastLine = lines[lines.length - 1] ?? "";
      return {
        lines: [this.truncateLineToFitRowsFromEnd(lastLine, safeWidth, maxRows)],
        startIdx: lines.length - 1,
      };
    }

    return { lines: lines.slice(startIdx), startIdx };
  }

  private getRenderBlocks(
    component: Component,
    width: number,
    path = "root",
  ): Array<{
    component: Component;
    key: string;
    lines: string[];
    persistence: RenderBlock["persistence"];
  }> {
    if (component instanceof Container) {
      return component.children.flatMap((child, index) => this.getRenderBlocks(child, width, `${path}.${index}`));
    }

    try {
      const blocks = component.renderBlocks?.(width) ?? [
        {
          key: "default",
          lines: component.render(width),
          persistence: "volatile" as const,
        },
      ];
      return blocks.map((block, index) => ({
        component,
        key: `${path}:${block.key || `block-${index}`}`,
        lines: [...block.lines],
        persistence: block.persistence,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return [
        {
          component,
          key: `${path}:error`,
          lines: [`[render error] ${message}`],
          persistence: "volatile",
        },
      ];
    }
  }

  /** Render using component-defined persistent/volatile blocks. */
  private doRender(): void {
    const width = Math.max(1, this.terminal.columns);
    const renderBlocks = this.getRenderBlocks(this.root, width);
    const allLines = renderBlocks.flatMap((block) => block.lines);
    const persistentCount = renderBlocks
      .filter((block) => block.persistence === "persistent")
      .reduce((sum, block) => sum + block.lines.length, 0);

    const persistentFlushLines: string[] = [];
    const activeBlocks = renderBlocks
      .filter((block) => block.persistence === "volatile")
      .map((block) => {
        const previousPersistentCount = this.persistentFlushedCounts.get(block.key);
        if (previousPersistentCount !== undefined) {
          this.persistentFlushedCounts.delete(block.key);
        }
        let cursorLineIndex = -1;
        let cursorCol = -1;
        const cleanLines = block.lines.map((line, index) => {
          const markerIdx = line.indexOf(CURSOR_MARKER);
          if (markerIdx === -1) {
            return line;
          }
          cursorLineIndex = index;
          cursorCol = displayWidth(stripAnsi(line.slice(0, markerIdx)));
          return line.replace(CURSOR_MARKER, "");
        });

        return {
          component: block.component,
          key: block.key,
          lines: cleanLines,
          cursorLineIndex,
          cursorCol,
        };
      });

    for (const block of renderBlocks) {
      if (block.persistence !== "persistent") {
        continue;
      }
      const previousCount = this.persistentFlushedCounts.get(block.key) ?? 0;
      if (block.lines.length > previousCount) {
        persistentFlushLines.push(...block.lines.slice(previousCount));
      }
      this.persistentFlushedCounts.set(block.key, Math.max(previousCount, block.lines.length));
      this.overflowFlushedCounts.delete(block.key);
    }

    const maxRows = Math.max(0, this.terminal.rows);
    const displayBlocks: Array<{
      component: Component;
      key: string;
      lines: string[];
      hiddenCount: number;
      cursorLineIndex: number;
      cursorCol: number;
    }> = [];
    let remainingRows = maxRows;

    for (let i = activeBlocks.length - 1; i >= 0; i--) {
      const block = activeBlocks[i];
      if (block.lines.length === 0) {
        displayBlocks.unshift({
          component: block.component,
          key: block.key,
          lines: [],
          hiddenCount: 0,
          cursorLineIndex: -1,
          cursorCol: block.cursorCol,
        });
        continue;
      }

      if (remainingRows <= 0) {
        displayBlocks.unshift({
          component: block.component,
          key: block.key,
          lines: [],
          hiddenCount: block.lines.length,
          cursorLineIndex: -1,
          cursorCol: block.cursorCol,
        });
        continue;
      }

      const { lines, startIdx } = this.sliceLinesToTerminalRows(block.lines, width, remainingRows);
      const visibleRows = this.countPhysicalTerminalRows(lines, width);
      remainingRows = Math.max(0, remainingRows - visibleRows);
      const visibleCursorLineIndex = block.cursorLineIndex === -1 ? -1 : block.cursorLineIndex - startIdx;

      displayBlocks.unshift({
        component: block.component,
        key: block.key,
        lines,
        hiddenCount: startIdx,
        cursorLineIndex:
          visibleCursorLineIndex >= 0 && visibleCursorLineIndex < lines.length ? visibleCursorLineIndex : -1,
        cursorCol: block.cursorCol,
      });
    }

    const overflowFlushLines: string[] = [];
    for (let i = 0; i < activeBlocks.length; i++) {
      const block = activeBlocks[i];
      const hiddenCount = displayBlocks[i]?.hiddenCount ?? 0;
      const previousHiddenCount = this.overflowFlushedCounts.get(block.key) ?? 0;
      if (hiddenCount > previousHiddenCount) {
        overflowFlushLines.push(...block.lines.slice(previousHiddenCount, hiddenCount));
      }
      this.overflowFlushedCounts.set(block.key, hiddenCount);
    }

    const displayActiveLines = displayBlocks.flatMap((block) => block.lines);
    let displayCursorRow = -1;
    let cursorCol = -1;
    let linesBeforeCursor = 0;
    for (const block of displayBlocks) {
      if (displayCursorRow === -1 && block.cursorLineIndex !== -1 && block.cursorCol !== -1) {
        displayCursorRow = linesBeforeCursor + block.cursorLineIndex;
        cursorCol = block.cursorCol;
      }
      linesBeforeCursor += block.lines.length;
    }

    // Erase previous active region
    if (this.lastActiveRows > 0) {
      this.clearPreviousActiveRegion();
    }

    const now = Date.now();
    const allowOverflowFlush =
      overflowFlushLines.length > 0 &&
      (this.lastOverflowFlushAt === 0 || now - this.lastOverflowFlushAt >= TUIRenderer.OVERFLOW_FLUSH_INTERVAL_MS);

    const historyFlushLines = this.pendingHistoryLines;
    this.pendingHistoryLines = [];

    if (historyFlushLines.length > 0 || persistentFlushLines.length > 0 || allowOverflowFlush) {
      const commitBatch = [
        ...historyFlushLines,
        ...persistentFlushLines,
        ...(allowOverflowFlush ? overflowFlushLines : []),
      ];
      if (commitBatch.length > 0) {
        const commitPayload = this.serializeLinesForTerminal(commitBatch, width, true);
        if (commitPayload.length > 0) {
          this.terminal.write(commitPayload);
        }
      }
      if (allowOverflowFlush) {
        this.lastOverflowFlushAt = now;
      }
    }

    // Write active region (redrawn each frame)
    const activePayload = this.serializeLinesForTerminal(displayActiveLines, width);
    this.terminal.writeSynchronized(activePayload);

    const totalActiveRows = this.countPhysicalTerminalRows(displayActiveLines, width);
    this.lastActiveRows = totalActiveRows;
    const endCursorRowInActive = Math.max(0, totalActiveRows - 1);

    // Position cursor within active region
    if (displayCursorRow !== -1 && cursorCol !== -1) {
      const linesBeforeCursor = displayActiveLines.slice(0, displayCursorRow);
      const rowsBefore = this.countPhysicalTerminalRows(linesBeforeCursor, width);
      const rowsToMoveUp = endCursorRowInActive - rowsBefore;
      this.terminal.write("\r");
      if (rowsToMoveUp > 0) {
        this.terminal.write(`\x1b[${rowsToMoveUp}A`);
      }
      if (cursorCol > 0) {
        this.terminal.write(`\x1b[${cursorCol}C`);
      }
      this.terminal.showCursor();
      this.lastCursorRowInActive = rowsBefore;
    } else {
      this.terminal.hideCursor();
      this.lastCursorRowInActive = endCursorRowInActive;
    }

    if (debugLogger.isEnabled) {
      debugLogger.logRender({
        termCols: this.terminal.columns,
        termRows: this.terminal.rows,
        newLines: allLines,
        cleanLines: displayActiveLines,
        committedCount: persistentCount,
        activeCount: activeBlocks.reduce((sum, block) => sum + block.lines.length, 0),
        activeDisplayCount: displayActiveLines.length,
        overflowCount: overflowFlushLines.length,
        cursorRow: displayCursorRow,
        cursorCol,
        fullOutput: displayActiveLines.join("\n"),
      });
    }
    this.lastRenderAt = Date.now();
  }

  private resolveMinRenderIntervalMs(): number {
    const raw = process.env.DILIGENT_TUI_MAX_FPS;
    const maxFps = raw ? Number.parseInt(raw, 10) : TUIRenderer.DEFAULT_MAX_FPS;
    if (!Number.isFinite(maxFps) || maxFps <= 0) {
      return Math.round(1000 / TUIRenderer.DEFAULT_MAX_FPS);
    }
    return Math.max(1, Math.round(1000 / maxFps));
  }

  /** Slice a string with ANSI codes by visible column positions */
  private sliceWithAnsi(str: string, start: number, end: number): string {
    let colIdx = 0;
    let result = "";
    let inEscape = false;
    let escapeSeq = "";

    for (const ch of str) {
      if (ch === "\x1b" || inEscape) {
        if (ch === "\x1b") {
          inEscape = true;
          escapeSeq = "\x1b";
        } else {
          escapeSeq += ch;
          if (ch.match(/[a-zA-Z]/)) {
            inEscape = false;
            if (colIdx >= start && colIdx < end) {
              result += escapeSeq;
            }
            escapeSeq = "";
          }
        }
        continue;
      }

      const w = charDisplayWidth(ch.codePointAt(0)!);
      if (colIdx >= start && colIdx + w <= end) {
        result += ch;
      }
      colIdx += w;

      if (colIdx >= end) break;
    }

    return result;
  }
}
