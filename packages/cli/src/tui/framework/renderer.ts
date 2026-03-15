// @summary Renders components to the terminal with diff-based updates
import { debugLogger } from "./debug-logger";
import type { OverlayStack } from "./overlay";
import { charDisplayWidth, displayWidth } from "./string-width";
import type { Terminal } from "./terminal";
import type { Component, Focusable } from "./types";
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
  private renderScheduled = false;
  private focusedComponent: (Component & Focusable) | null = null;
  private overlayStack: OverlayStack | null = null;
  private started = false;
  private flushedCommittedCount = 0; // committed lines already written to scrollback
  private lastActiveRows = 0; // terminal rows occupied by previous active region
  private lastCursorRowInActive = 0; // cursor row within active region (for rewind)

  constructor(
    private terminal: Terminal,
    private root: Component,
  ) {}

  /** Set the overlay stack for compositing */
  setOverlayStack(overlayStack: OverlayStack): void {
    this.overlayStack = overlayStack;
  }

  /** Schedule a render on next tick (coalesces multiple requests) */
  requestRender(): void {
    if (this.renderScheduled || !this.started) return;
    this.renderScheduled = true;
    queueMicrotask(() => {
      this.renderScheduled = false;
      if (this.started) {
        this.doRender();
      }
    });
  }

  /** Force an immediate render */
  forceRender(): void {
    if (this.started) {
      this.doRender();
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
    this.flushedCommittedCount = 0;
    this.lastActiveRows = 0;
    this.lastCursorRowInActive = 0;
  }

  /** Stop rendering — clear active region, leave committed lines in scrollback */
  stop(): void {
    this.started = false;
    this.renderScheduled = false;
    // Erase active region so only committed lines remain in scrollback
    if (this.lastActiveRows > 0) {
      this.terminal.write("\r");
      if (this.lastCursorRowInActive > 0) {
        this.terminal.write(`\x1b[${this.lastCursorRowInActive}A`);
      }
      this.terminal.write("\x1b[0J");
    }
    this.resetFrameState();
    this.terminal.showCursor();
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

  /** Render with committed/active split: committed lines go to scrollback once,
   *  active lines are redrawn each frame. */
  private doRender(): void {
    const width = Math.max(1, this.terminal.columns);

    let allLines: string[];
    try {
      allLines = this.root.render(width);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      allLines = [`[render error] ${message}`];
    }

    // Determine committed line count (monotonically increasing)
    // Cap to current frame length because historical scrollback may already
    // contain lines that no longer exist in the latest render output.
    let committedCount = 0;
    try {
      committedCount = this.root.getCommittedLineCount?.(width) ?? 0;
    } catch {
      committedCount = 0;
    }
    committedCount = Math.min(allLines.length, Math.max(committedCount, this.flushedCommittedCount));

    // Split into committed and active regions
    const committedLines = allLines.slice(0, committedCount);
    let activeLines = allLines.slice(committedCount);

    // Apply overlays only to the active region
    if (this.overlayStack?.hasVisible()) {
      activeLines = this.compositeOverlays(activeLines, width);
    }

    // Find cursor marker — only in active region
    let cursorRow = -1;
    let cursorCol = -1;
    const cleanActive: string[] = [];
    for (let i = 0; i < activeLines.length; i++) {
      const markerIdx = activeLines[i].indexOf(CURSOR_MARKER);
      if (markerIdx !== -1) {
        cursorRow = i;
        cursorCol = displayWidth(stripAnsi(activeLines[i].slice(0, markerIdx)));
        cleanActive.push(activeLines[i].replace(CURSOR_MARKER, ""));
      } else {
        cleanActive.push(activeLines[i]);
      }
    }

    // Cap active content to the terminal's visible physical rows.
    // Using logical line count here causes wrapped lines to spill into scrollback,
    // which then shows duplicated content during repeated redraws.
    const maxRows = Math.max(0, this.terminal.rows);
    let displayActiveLines = cleanActive;
    let displayCursorRow = cursorRow;
    let overflowActiveLines: string[] = [];
    if (maxRows === 0) {
      overflowActiveLines = cleanActive;
      displayActiveLines = [];
      displayCursorRow = -1;
      cursorCol = -1;
    } else if (this.countPhysicalTerminalRows(cleanActive, width) > maxRows) {
      const { lines, startIdx } = this.sliceLinesToTerminalRows(cleanActive, width, maxRows);
      displayActiveLines = lines;
      // Persist clipped prefix into native scrollback so past output doesn't vanish.
      // Skip this while overlays are visible because overlay frames are transient.
      if (!this.overlayStack?.hasVisible() && startIdx > 0) {
        overflowActiveLines = cleanActive.slice(0, startIdx);
      }
      if (cursorRow !== -1) {
        displayCursorRow = cursorRow - startIdx;
        if (displayCursorRow < 0 || displayCursorRow >= displayActiveLines.length) {
          displayCursorRow = -1;
          cursorCol = -1;
        }
      }
    }

    // How many new committed lines to flush this frame
    const committedFlushStart = Math.min(this.flushedCommittedCount, committedCount);
    const newCommittedCount = committedCount - committedFlushStart;

    // Erase previous active region
    if (this.lastActiveRows > 0) {
      this.terminal.write("\r");
      if (this.lastCursorRowInActive > 0) {
        this.terminal.write(`\x1b[${this.lastCursorRowInActive}A`);
      }
      this.terminal.write("\x1b[0J");
    }

    // Write newly committed lines to scrollback (permanent)
    if (newCommittedCount > 0 || overflowActiveLines.length > 0) {
      const newLines = committedLines.slice(committedFlushStart);
      const commitBatch = [...newLines, ...overflowActiveLines];
      if (commitBatch.length > 0) {
        const commitPayload = this.serializeLinesForTerminal(commitBatch, width, true);
        if (commitPayload.length > 0) {
          this.terminal.write(commitPayload);
        }
      }
      this.flushedCommittedCount = Math.max(this.flushedCommittedCount, committedCount + overflowActiveLines.length);
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
        cursorRow: displayCursorRow,
        cursorCol,
        fullOutput: displayActiveLines.join("\n"),
      });
    }
  }

  private compositeOverlays(baseLines: string[], width: number): string[] {
    if (!this.overlayStack) return baseLines;

    const visible = this.overlayStack.getVisible();
    if (visible.length === 0) return baseLines;

    const result = [...baseLines];

    // Pad to terminal height only when a center-anchored overlay needs room.
    const hasCenterOverlay = visible.some(({ options: o }) => (o.anchor ?? "center") === "center");
    const topPad = hasCenterOverlay ? Math.max(0, this.terminal.rows - result.length) : 0;
    for (let i = 0; i < topPad; i++) {
      result.unshift("");
    }

    for (const { component, options } of visible) {
      const overlayLines = component.render(width);
      if (overlayLines.length === 0) continue;

      const overlayWidth = overlayLines.reduce(
        (max: number, line: string) => Math.max(max, displayWidth(stripAnsi(line))),
        0,
      );

      let startRow: number;
      let startCol: number;
      const anchor = options.anchor ?? "center";
      const totalRows = result.length;

      switch (anchor) {
        case "center":
          startRow = Math.max(0, Math.floor((totalRows - overlayLines.length) / 2));
          startCol = Math.max(0, Math.floor((width - overlayWidth) / 2));
          break;
        case "bottom-center":
          startRow = Math.max(0, totalRows - overlayLines.length - 2);
          startCol = Math.max(0, Math.floor((width - overlayWidth) / 2));
          break;
        case "top-left":
          startRow = (options.offsetY ?? 0) + topPad;
          startCol = options.offsetX ?? 0;
          break;
        default:
          startRow = Math.max(0, Math.floor((totalRows - overlayLines.length) / 2));
          startCol = Math.max(0, Math.floor((width - overlayWidth) / 2));
      }

      // Ensure enough lines exist
      while (result.length < startRow + overlayLines.length) {
        result.push("");
      }

      // Splice overlay lines into base
      for (let i = 0; i < overlayLines.length; i++) {
        const row = startRow + i;
        if (row < result.length) {
          const baseLine = result[row];
          const baseVisibleWidth = displayWidth(stripAnsi(baseLine));

          // Build composited line: base before overlay, overlay, base after overlay
          let composited = "";

          // Pad base to reach startCol
          if (baseVisibleWidth < startCol) {
            composited = baseLine + " ".repeat(startCol - baseVisibleWidth);
          } else {
            // Reconstruct base up to startCol (preserving ANSI)
            composited = this.sliceWithAnsi(baseLine, 0, startCol);
          }

          composited += `\x1b[0m${overlayLines[i]}\x1b[0m`;

          // Add rest of base line after overlay
          const overlayVisibleWidth = displayWidth(stripAnsi(overlayLines[i]));
          const afterCol = startCol + overlayVisibleWidth;
          if (baseVisibleWidth > afterCol) {
            composited += this.sliceWithAnsi(baseLine, afterCol, baseVisibleWidth);
          }

          result[row] = composited;
        }
      }
    }

    return result;
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
