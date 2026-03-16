// @summary Tests for TUI renderer and component rendering pipeline
import { describe, expect, test } from "bun:test";
import { Container } from "../../../src/tui/framework/container";
import { TUIRenderer } from "../../../src/tui/framework/renderer";
import type { Terminal } from "../../../src/tui/framework/terminal";
import type { Component, RenderBlock } from "../../../src/tui/framework/types";
import { CURSOR_MARKER } from "../../../src/tui/framework/types";

// ---------------------------------------------------------------------------
// Terminal simulator — parses ANSI sequences to track real cursor + screen
// ---------------------------------------------------------------------------

class TerminalSim {
  rows: number;
  columns: number;
  /** screen[row] = visible text on that row */
  screen: string[];
  cursorRow = 0;
  cursorCol = 0;

  constructor(rows = 24, columns = 80) {
    this.rows = rows;
    this.columns = columns;
    this.screen = Array(rows).fill("");
  }

  /** Feed raw output (write or writeSynchronized) */
  feed(data: string): void {
    // Strip sync markers
    data = data.replace(/\x1b\[\?2026[hl]/g, "");
    let i = 0;
    while (i < data.length) {
      if (data[i] === "\x1b") {
        const seq = this._parseEscape(data, i);
        this._applyEscape(seq);
        i += seq.length;
      } else if (data[i] === "\r") {
        this.cursorCol = 0;
        i++;
      } else if (data[i] === "\n") {
        this.cursorRow++;
        if (this.cursorRow >= this.screen.length) {
          this.screen.push("");
        }
        i++;
      } else {
        this._writeChar(data[i]);
        i++;
      }
    }
  }

  /** The visible text at the cursor row (for assertion) */
  lineAt(row: number): string {
    return this.screen[row] ?? "";
  }

  /** All non-empty lines */
  visibleLines(): string[] {
    return this.screen.filter((l) => l.length > 0);
  }

  private _writeChar(ch: string): void {
    while (this.screen.length <= this.cursorRow) this.screen.push("");
    const row = this.screen[this.cursorRow];
    const before = row.slice(0, this.cursorCol);
    const after = row.slice(this.cursorCol + 1);
    this.screen[this.cursorRow] = before + ch + after;
    this.cursorCol++;

    // Simulate terminal auto-wrap when writing at right boundary.
    if (this.cursorCol >= this.columns) {
      this.cursorCol = 0;
      this.cursorRow++;
      while (this.screen.length <= this.cursorRow) this.screen.push("");
    }
  }

  private _parseEscape(data: string, start: number): string {
    if (start + 1 >= data.length) return data[start];
    const next = data[start + 1];
    if (next === "[") {
      // CSI
      let i = start + 2;
      while (i < data.length && !data[i].match(/[A-Za-z]/)) i++;
      if (i < data.length) i++;
      return data.slice(start, i);
    }
    // APC / other: read until BEL or ST
    if (next === "_") {
      let i = start + 2;
      while (i < data.length && data[i] !== "\x07" && !(data[i] === "\x1b" && data[i + 1] === "\\")) i++;
      if (i < data.length) i++;
      return data.slice(start, i);
    }
    return data.slice(start, start + 2);
  }

  private _applyEscape(seq: string): void {
    // CSI sequences only
    const csi = seq.match(/^\x1b\[(\??[0-9;]*)([A-Za-z])$/);
    if (!csi) return;
    const params = csi[1].replace("?", "");
    const cmd = csi[2];
    const n = parseInt(params !== "" ? params : "1", 10) || 1;

    switch (cmd) {
      case "A": // cursor up
        this.cursorRow = Math.max(0, this.cursorRow - n);
        break;
      case "B": // cursor down
        this.cursorRow += n;
        while (this.screen.length <= this.cursorRow) this.screen.push("");
        break;
      case "C": // cursor right
        this.cursorCol += n;
        break;
      case "D": // cursor left
        this.cursorCol = Math.max(0, this.cursorCol - n);
        break;
      case "K": // erase line
        while (this.screen.length <= this.cursorRow) this.screen.push("");
        this.screen[this.cursorRow] = "";
        this.cursorCol = 0;
        break;
      case "H": // cursor position
        if (params === "" || params === "1;1") {
          this.cursorRow = 0;
          this.cursorCol = 0;
        } else if (params.includes(";")) {
          const parts = params.split(";");
          this.cursorRow = Math.max(0, (parseInt(parts[0] || "1", 10) || 1) - 1);
          this.cursorCol = Math.max(0, (parseInt(parts[1] || "1", 10) || 1) - 1);
        }
        break;
      case "J": {
        const jn = parseInt(params !== "" ? params : "0", 10);
        if (jn === 2) {
          this.screen = Array(this.rows).fill("");
          this.cursorRow = 0;
          this.cursorCol = 0;
        } else if (jn === 0) {
          // Erase from cursor to end of screen
          while (this.screen.length <= this.cursorRow) this.screen.push("");
          this.screen[this.cursorRow] = this.screen[this.cursorRow].slice(0, this.cursorCol);
          for (let i = this.cursorRow + 1; i < this.screen.length; i++) this.screen[i] = "";
        }
        break;
      }
    }
  }
}

function createSim(rows = 24, columns = 80): { terminal: Terminal; sim: TerminalSim } {
  const sim = new TerminalSim(rows, columns);
  const terminal = {
    get columns() {
      return sim.columns;
    },
    get rows() {
      return sim.rows;
    },
    isKittyEnabled: false,
    write(data: string) {
      sim.feed(data);
    },
    writeSynchronized(data: string) {
      sim.feed(data);
    },
    hideCursor() {},
    showCursor() {},
    moveCursorTo(row: number, col: number) {
      sim.feed(`\x1b[${row + 1};${col + 1}H`);
    },
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {
      sim.feed("\x1b[2J\x1b[H");
    },
    moveBy() {},
    start() {},
    stop() {},
  } as unknown as Terminal;

  return { terminal, sim };
}

function createStaticComponent(lines: string[]): Component {
  return {
    render(_width: number) {
      return [...lines];
    },
    invalidate() {},
  };
}

/** Component that embeds CURSOR_MARKER at given col on row 0 */
function createInputComponent(text = "", col?: number): Component {
  return {
    render(_width: number) {
      const c = col ?? text.length;
      return [`prompt> ${text.slice(0, c)}${CURSOR_MARKER}${text.slice(c)}`];
    },
    invalidate() {},
  };
}

// ---------------------------------------------------------------------------
// Renderer tests — using TerminalSim for realistic cursor tracking
// ---------------------------------------------------------------------------

describe("TUIRenderer — cursor position after renders", () => {
  test("cursor lands on input row after first render", () => {
    const { terminal, sim } = createSim();
    const container = new Container();
    container.addChild(createStaticComponent(["chat line 1", "chat line 2"]));
    container.addChild(createInputComponent());

    const renderer = new TUIRenderer(terminal, container);
    renderer.start();

    // cursor should be on row 2 (the input row, 0-indexed)
    expect(sim.cursorRow).toBe(2);
    expect(sim.lineAt(2)).toBe("prompt> ");
  });

  test("cursor stays on input row after content grows above it", () => {
    const { terminal, sim } = createSim();
    let chatLines = ["chat line 1"];
    const container = new Container();
    const chatComponent: Component = {
      render: () => [...chatLines],
      invalidate: () => {},
    };
    container.addChild(chatComponent);
    container.addChild(createInputComponent());

    const renderer = new TUIRenderer(terminal, container);
    renderer.start();

    // Simulate tool output appended — chat grows
    chatLines = ["chat line 1", "tool output", "token info"];
    renderer.forceRender();

    // cursor should be on row 3 (new input row)
    expect(sim.cursorRow).toBe(3);
    expect(sim.lineAt(3)).toBe("prompt> ");
  });

  test("cursor stays on input row after multiple tool output batches", () => {
    const { terminal, sim } = createSim();
    let chatLines: string[] = [];
    const container = new Container();
    const chatComponent: Component = {
      render: () => [...chatLines],
      invalidate: () => {},
    };
    container.addChild(chatComponent);
    container.addChild(createInputComponent());

    const renderer = new TUIRenderer(terminal, container);
    renderer.start();

    // Simulate 3 rounds of tool output
    for (let i = 1; i <= 3; i++) {
      chatLines = [...chatLines, `[tool${i}]`, `  output line`, `  second line`];
      renderer.forceRender();

      const expectedInputRow = chatLines.length;
      expect(sim.cursorRow).toBe(expectedInputRow);
      expect(sim.lineAt(expectedInputRow)).toBe("prompt> ");
    }
  });

  test("cursor col is correct when input has text", () => {
    const { terminal, sim } = createSim();
    const container = new Container();
    container.addChild(createStaticComponent(["chat"]));
    container.addChild(createInputComponent("hello"));

    const renderer = new TUIRenderer(terminal, container);
    renderer.start();

    // cursor col: "prompt> hello" = 13 chars
    expect(sim.cursorRow).toBe(1);
    expect(sim.cursorCol).toBe(13);
  });

  test("cursor col is correct when cursor is mid-text", () => {
    const { terminal, sim } = createSim();
    const container = new Container();
    container.addChild(createStaticComponent(["chat"]));
    container.addChild(createInputComponent("hello", 2)); // cursor after 'he'

    const renderer = new TUIRenderer(terminal, container);
    renderer.start();

    // "prompt> he" = 10 chars
    expect(sim.cursorCol).toBe(10);
  });

  test("cursor col accounts for single-width dingbat prompt glyphs", () => {
    const { terminal, sim } = createSim();
    const container = new Container();
    container.addChild(createStaticComponent(["chat"]));
    container.addChild({
      render() {
        return [`❯ ${CURSOR_MARKER}abc`];
      },
      invalidate() {},
    });

    const renderer = new TUIRenderer(terminal, container);
    renderer.start();

    // cursor should sit right after "❯ " (2 columns total)
    expect(sim.cursorCol).toBe(2);
  });

  test("no duplicate input row after content changes", () => {
    const { terminal, sim } = createSim();
    let chatLines = ["welcome"];
    const container = new Container();
    const chatComponent: Component = {
      render: () => [...chatLines],
      invalidate: () => {},
    };
    container.addChild(chatComponent);
    container.addChild(createInputComponent());

    const renderer = new TUIRenderer(terminal, container);
    renderer.start();

    chatLines = ["welcome", "user message", "tool output", "response"];
    renderer.forceRender();

    // "prompt> " should appear exactly once
    const promptCount = sim.screen.filter((l) => l === "prompt> ").length;
    expect(promptCount).toBe(1);
  });

  test("wrapped active lines do not spill duplicate content into scrollback", () => {
    const { terminal, sim } = createSim(4, 10);
    let chatLines = ["12345678901234567890", "abcdefghijabcdefghij"];
    const container = new Container();
    const chatComponent: Component = {
      render: () => [...chatLines],
      invalidate: () => {},
    };
    container.addChild(chatComponent);
    container.addChild(createInputComponent());

    const renderer = new TUIRenderer(terminal, container);
    renderer.start();

    const firstPromptCount = sim.screen.filter((l) => l === "prompt> ").length;
    expect(firstPromptCount).toBe(1);

    chatLines = ["12345678901234567890", "abcdefghijabcdefghij", "tail"];
    renderer.forceRender();

    const promptCount = sim.screen.filter((l) => l === "prompt> ").length;
    expect(promptCount).toBe(1);
    expect(sim.screen.filter((l) => l === "tail").length).toBeLessThanOrEqual(1);
  });

  test("overflowing active history is preserved in scrollback across redraws", () => {
    const { terminal, sim } = createSim(4, 10);
    let chatLines = ["line-1", "line-2", "line-3", "line-4", "line-5", "line-6"];
    const container = new Container();
    const chatComponent: Component = {
      render: () => [...chatLines],
      invalidate: () => {},
    };
    container.addChild(chatComponent);
    container.addChild(createInputComponent());

    const renderer = new TUIRenderer(terminal, container);
    renderer.start();

    // Oldest lines are clipped from viewport but should remain above as scrollback.
    expect(sim.screen.some((l) => l === "line-1")).toBe(true);

    chatLines = [...chatLines, "line-7"];
    renderer.forceRender();

    // Another redraw should not erase earlier clipped lines.
    expect(sim.screen.some((l) => l === "line-1")).toBe(true);
    expect(sim.screen.filter((l) => l === "line-7").length).toBeLessThanOrEqual(1);
  });

  test("single long active line exceeding viewport rows does not erase history", () => {
    const { terminal, sim } = createSim(3, 10);
    let chatLines = ["short-1", "short-2", "short-3"];
    const container = new Container();
    const chatComponent: Component = {
      render: () => [...chatLines],
      invalidate: () => {},
    };
    container.addChild(chatComponent);
    container.addChild(createInputComponent());

    const renderer = new TUIRenderer(terminal, container);
    renderer.start();

    expect(sim.screen.some((l) => l === "short-1")).toBe(true);

    chatLines = ["1234567890123456789012345678901234567890"];
    renderer.forceRender();

    renderer.forceRender();

    // Historical rows should still be present in scrollback after repeated redraws.
    expect(sim.screen.some((l) => l === "short-1")).toBe(true);
    expect(sim.screen.filter((l) => l === "short-1").length).toBe(1);
  });

  test("committed welcome and user lines are preserved while active body grows", () => {
    const { terminal, sim } = createSim(8, 20);
    const historyLines = ["welcome box", "tip line", "user message"];
    let activeLines = ["body-1"];
    const container = new Container();
    const chatComponent: Component = {
      render: () => [...historyLines, ...activeLines],
      renderBlocks: () => [
        { key: "history", lines: [...historyLines], persistence: "persistent" },
        { key: "active", lines: [...activeLines], persistence: "volatile" },
      ],
      invalidate: () => {},
    };
    container.addChild(chatComponent);
    container.addChild(createInputComponent());

    const renderer = new TUIRenderer(terminal, container);
    renderer.start();

    activeLines = ["body-1", "body-2", "body-3", "body-4", "body-5", "body-6"];
    renderer.forceRender();
    renderer.forceRender();

    expect(sim.screen.some((l) => l === "welcome box")).toBe(true);
    expect(sim.screen.some((l) => l === "user message")).toBe(true);
  });

  test("overflow trims upper component blocks before live stack and input", () => {
    const { terminal, sim } = createSim(3, 20);
    const container = new Container();
    let bodyLines = ["body-1", "body-2", "body-3"];
    const bodyComponent: Component = {
      render: () => [...bodyLines],
      invalidate: () => {},
    };
    const liveStackComponent: Component = {
      render: () => ["live-status"],
      invalidate: () => {},
    };

    container.addChild(bodyComponent);
    container.addChild(liveStackComponent);
    container.addChild(createInputComponent());

    const renderer = new TUIRenderer(terminal, container);
    renderer.start();

    expect(sim.screen.some((line) => line === "body-1")).toBe(true);

    bodyLines = ["body-1", "body-2", "body-3", "body-4"];
    renderer.forceRender();

    expect(sim.screen.some((line) => line === "live-status")).toBe(true);
    expect(sim.screen.some((line) => line === "prompt> ")).toBe(true);
    expect(sim.screen.some((line) => line === "body-4")).toBe(true);
  });

  test("scrollback retains welcome box and all rendered component bands after long output completes", () => {
    const { terminal, sim } = createSim(4, 20);
    let bodyLines = ["result-1"];
    const container = new Container();
    const welcomeComponent: Component = {
      render: () => ["welcome box", "tip line"],
      renderBlocks: () => [{ key: "welcome", lines: ["welcome box", "tip line"], persistence: "persistent" }],
      invalidate: () => {},
    };
    const bodyComponent: Component = {
      render: () => [...bodyLines],
      renderBlocks: () => [{ key: "body", lines: [...bodyLines], persistence: "volatile" }],
      invalidate: () => {},
    };
    const liveStackComponent: Component = {
      render: () => ["live-status"],
      invalidate: () => {},
    };
    const statusComponent: Component = {
      render: () => ["status-bar"],
      invalidate: () => {},
    };

    container.addChild(welcomeComponent);
    container.addChild(bodyComponent);
    container.addChild(liveStackComponent);
    container.addChild(createInputComponent());
    container.addChild(statusComponent);

    const renderer = new TUIRenderer(terminal, container);
    renderer.start();

    bodyLines = Array.from({ length: 12 }, (_, index) => `result-${index + 1}`);
    renderer.forceRender();
    renderer.forceRender();

    expect(sim.screen.some((line) => line === "welcome box")).toBe(true);
    expect(sim.screen.some((line) => line === "tip line")).toBe(true);
    expect(sim.screen.some((line) => line === "live-status")).toBe(true);
    expect(sim.screen.some((line) => line === "prompt> ")).toBe(true);
    expect(sim.screen.some((line) => line === "status-bar")).toBe(true);
    expect(sim.screen.some((line) => line === "result-12")).toBe(true);
  });

  test("adding a new bottom component preserves older bottom bands in scrollback", () => {
    const { terminal, sim } = createSim(3, 20);
    let liveBlocks: RenderBlock[] = [{ key: "status", lines: ["live-status"], persistence: "volatile" }];
    const container = new Container();
    const liveStackComponent: Component = {
      render: () => liveBlocks.flatMap((block) => block.lines),
      renderBlocks: () => liveBlocks,
      invalidate: () => {},
    };
    const inputComponent = createInputComponent();
    const statusComponent: Component = {
      render: () => ["status-bar"],
      invalidate: () => {},
    };

    container.addChild(liveStackComponent);
    container.addChild(inputComponent);
    container.addChild(statusComponent);

    const renderer = new TUIRenderer(terminal, container);
    renderer.start();

    liveBlocks = [
      { key: "status", lines: ["live-status"], persistence: "volatile" },
      { key: "question-separator", lines: [""], persistence: "volatile" },
      { key: "question", lines: ["question prompt"], persistence: "volatile" },
    ];
    renderer.forceRender();

    expect(sim.screen.some((line) => line === "live-status")).toBe(true);
    expect(sim.screen.some((line) => line === "question prompt")).toBe(true);
    expect(sim.screen.some((line) => line === "prompt> ")).toBe(true);
  });

  test("viewport shrink redraw does not duplicate bottom status line", () => {
    const { terminal, sim } = createSim(8, 120);
    const statusLine = "chatgpt-5.3-codex · 0 / 300K (0%) · ~/git/diligent · thinking:low";
    const container = new Container();
    container.addChild(createStaticComponent(["history line"]));
    container.addChild(createInputComponent());
    container.addChild(createStaticComponent([statusLine]));

    const renderer = new TUIRenderer(terminal, container);
    renderer.start();

    // Simulate terminal width shrink then redraw.
    sim.columns = 90;
    renderer.forceRender();

    const duplicatedLines = sim.visibleLines().filter((line) => line.includes(statusLine));
    expect(duplicatedLines.length).toBe(1);
  });

  test("viewport redraw replays persistent history before bottom input pane", () => {
    const { terminal, sim } = createSim(8, 80);
    const container = new Container();
    const historyComponent: Component = {
      render: () => ["welcome line", "older message"],
      renderBlocks: () => [{ key: "history", lines: ["welcome line", "older message"], persistence: "persistent" }],
      invalidate: () => {},
    };
    container.addChild(historyComponent);
    container.addChild(createInputComponent());

    const renderer = new TUIRenderer(terminal, container);
    renderer.start();

    expect(sim.lineAt(0)).toBe("welcome line");
    expect(sim.lineAt(2)).toBe("prompt> ");

    sim.columns = 60;
    renderer.forceRender();

    expect(sim.lineAt(0)).toBe("welcome line");
    expect(sim.lineAt(1)).toBe("older message");
    expect(sim.lineAt(2)).toBe("prompt> ");
    expect(sim.cursorRow).toBe(2);
  });

  test("cursor stays on the next logical row when active content ends on wrap boundary", () => {
    const { terminal, sim } = createSim(6, 10);
    let chatLines = ["1234567890"]; // exactly fills one terminal row
    const container = new Container();
    const chatComponent: Component = {
      render: () => [...chatLines],
      invalidate: () => {},
    };
    container.addChild(chatComponent);
    container.addChild(createInputComponent());

    const renderer = new TUIRenderer(terminal, container);
    renderer.start();

    // Input should remain on the next logical row, not drift upward across re-renders.
    expect(sim.lineAt(1)).toBe("prompt> ");

    renderer.forceRender();
    expect(sim.lineAt(1)).toBe("prompt> ");

    chatLines = ["1234567890", "abcdefghij"]; // both boundary-width lines
    renderer.forceRender();

    expect(sim.lineAt(2)).toBe("prompt> ");
  });

  test("cursor stays on input row when content shrinks (spinner → no-output tool)", () => {
    // Regression: spinner disappears without tool output → content shrinks by 1.
    // The renderer must move the cursor UP when last-changed row is past newLines end.
    const { terminal, sim } = createSim();
    let chatLines = ["chat line 1", "spinner running"];
    const container = new Container();
    const chatComponent: Component = {
      render: () => [...chatLines],
      invalidate: () => {},
    };
    container.addChild(chatComponent);
    container.addChild(createInputComponent());

    const renderer = new TUIRenderer(terminal, container);
    renderer.start();

    // State: ["chat line 1", "spinner running", "prompt> "] — 3 lines, cursor at row 2
    expect(sim.cursorRow).toBe(2);
    expect(sim.lineAt(2)).toBe("prompt> ");

    // Spinner disappears (content shrinks by 1) — simulates tool_end with no output
    chatLines = ["chat line 1"];
    renderer.forceRender();

    // State: ["chat line 1", "prompt> "] — 2 lines, cursor must be at row 1
    expect(sim.cursorRow).toBe(1);
    expect(sim.lineAt(1)).toBe("prompt> ");

    // One more render to verify prevCursorRow is correct after shrink
    renderer.forceRender();
    expect(sim.cursorRow).toBe(1);
    expect(sim.lineAt(1)).toBe("prompt> ");
  });

  test("cursor stays correct across grow-shrink-grow cycle", () => {
    const { terminal, sim } = createSim();
    let chatLines: string[] = [];
    const container = new Container();
    const chatComponent: Component = {
      render: () => [...chatLines],
      invalidate: () => {},
    };
    container.addChild(chatComponent);
    container.addChild(createInputComponent());

    const renderer = new TUIRenderer(terminal, container);
    renderer.start();

    // Grow
    chatLines = ["line1", "line2", "spinner"];
    renderer.forceRender();
    expect(sim.cursorRow).toBe(3);

    // Shrink (spinner removed, nothing added)
    chatLines = ["line1", "line2"];
    renderer.forceRender();
    expect(sim.cursorRow).toBe(2);
    expect(sim.lineAt(2)).toBe("prompt> ");

    // Grow again
    chatLines = ["line1", "line2", "tool output", "more output"];
    renderer.forceRender();
    expect(sim.cursorRow).toBe(4);
    expect(sim.lineAt(4)).toBe("prompt> ");
  });
});

describe("TUIRenderer — original tests", () => {
  function createMockTerminal(): Terminal & { output: string[]; syncOutput: string[] } {
    const output: string[] = [];
    const syncOutput: string[] = [];
    return {
      output,
      syncOutput,
      columns: 80,
      rows: 24,
      isKittyEnabled: false,
      write(data: string) {
        output.push(data);
      },
      writeSynchronized(data: string) {
        syncOutput.push(data);
      },
      hideCursor() {
        output.push("HIDE_CURSOR");
      },
      showCursor() {
        output.push("SHOW_CURSOR");
      },
      moveCursorTo(_row: number, _col: number) {},
      clearLine() {},
      clearFromCursor() {},
      clearScreen() {
        output.push("CLEAR_SCREEN");
      },
      moveBy(_lines: number) {},
      start() {},
      stop() {},
    } as unknown as Terminal & { output: string[]; syncOutput: string[] };
  }

  test("renders initial content", () => {
    const terminal = createMockTerminal();
    const component = createStaticComponent(["Hello", "World"]);
    const renderer = new TUIRenderer(terminal, component);

    renderer.start();

    const rendered = terminal.syncOutput.join("");
    expect(rendered).toContain("Hello");
    expect(rendered).toContain("World");
  });

  test("re-renders all lines on update (full redraw — no diff)", () => {
    const terminal = createMockTerminal();
    let lines = ["Line 1", "Line 2", "Line 3"];
    const component: Component = {
      render(_width: number) {
        return [...lines];
      },
      invalidate() {},
    };

    const renderer = new TUIRenderer(terminal, component);
    renderer.start();
    terminal.syncOutput.length = 0;

    lines = ["Line 1", "Changed", "Line 3"];
    renderer.forceRender();

    const update = terminal.syncOutput.join("");
    // Changed line is present
    expect(update).toContain("Changed");
    // Unchanged lines are also re-emitted (full redraw, not diff)
    expect(update).toContain("Line 1");
    expect(update).toContain("Line 3");
  });

  test("re-renders all lines when content grows", () => {
    const terminal = createMockTerminal();
    let lines = ["Line 1"];
    const component: Component = {
      render(_width: number) {
        return [...lines];
      },
      invalidate() {},
    };

    const renderer = new TUIRenderer(terminal, component);
    renderer.start();
    terminal.syncOutput.length = 0;

    lines = ["Line 1", "Line 2", "Line 3"];
    renderer.forceRender();

    const update = terminal.syncOutput.join("");
    // All lines present — including the original one
    expect(update).toContain("Line 1");
    expect(update).toContain("Line 2");
    expect(update).toContain("Line 3");
  });

  test("re-renders all remaining lines when content shrinks", () => {
    const terminal = createMockTerminal();
    let lines = ["Line 1", "Line 2", "Line 3"];
    const component: Component = {
      render(_width: number) {
        return [...lines];
      },
      invalidate() {},
    };

    const renderer = new TUIRenderer(terminal, component);
    renderer.start();
    terminal.syncOutput.length = 0;

    lines = ["Line 1"];
    renderer.forceRender();

    const update = terminal.syncOutput.join("");
    // Remaining line is present; removed lines are not
    expect(update).toContain("Line 1");
    expect(update).not.toContain("Line 2");
    expect(update).not.toContain("Line 3");
  });

  test("every render re-emits all content", () => {
    const terminal = createMockTerminal();
    const component = createStaticComponent(["Static line"]);

    const renderer = new TUIRenderer(terminal, component);
    renderer.start();
    terminal.syncOutput.length = 0;

    renderer.forceRender();

    const update = terminal.syncOutput.join("");
    expect(update).toContain("Static line");
  });
});

// ---------------------------------------------------------------------------
// Helper: component with explicit persistent/volatile blocks
// ---------------------------------------------------------------------------

function createBlockComponent(getBlocks: () => RenderBlock[]): Component {
  return {
    render(_width: number) {
      return getBlocks().flatMap((block) => block.lines);
    },
    renderBlocks: () => getBlocks(),
    invalidate() {},
  };
}

// ---------------------------------------------------------------------------
// Renderer tests — persistent/volatile blocks
// ---------------------------------------------------------------------------

describe("TUIRenderer — persistent/volatile blocks", () => {
  test("persistent lines written to scrollback only once", () => {
    const { terminal, sim } = createSim();
    let active = ["active"];

    const root = createBlockComponent(() => [
      { key: "history", lines: ["committed1", "committed2"], persistence: "persistent" },
      { key: "active", lines: [...active], persistence: "volatile" },
    ]);

    const renderer = new TUIRenderer(terminal, root);
    renderer.start();

    // After first render: all 3 lines visible
    expect(sim.lineAt(0)).toBe("committed1");
    expect(sim.lineAt(1)).toBe("committed2");
    expect(sim.lineAt(2)).toBe("active");

    // Re-render with same content — persistent lines should not be duplicated
    active = ["active-changed"];
    renderer.forceRender();

    // persistent lines still at rows 0-1, active at row 2
    expect(sim.lineAt(0)).toBe("committed1");
    expect(sim.lineAt(1)).toBe("committed2");
    expect(sim.lineAt(2)).toBe("active-changed");

    // "committed1" appears exactly once on screen
    const count = sim.screen.filter((l) => l === "committed1").length;
    expect(count).toBe(1);
  });

  test("new persistent lines appear before volatile content", () => {
    const { terminal, sim } = createSim();
    let history = ["c1"];
    const active = ["active"];

    const root = createBlockComponent(() => [
      { key: "history", lines: [...history], persistence: "persistent" },
      { key: "active", lines: [...active], persistence: "volatile" },
    ]);

    const renderer = new TUIRenderer(terminal, root);
    renderer.start();

    expect(sim.lineAt(0)).toBe("c1");
    expect(sim.lineAt(1)).toBe("active");

    // Add a new persistent line
    history = ["c1", "c2"];
    renderer.forceRender();

    expect(sim.lineAt(0)).toBe("c1");
    expect(sim.lineAt(1)).toBe("c2");
    expect(sim.lineAt(2)).toBe("active");
  });

  test("persistent history does not get erased when current block shrinks", () => {
    const { terminal, sim } = createSim();
    let history = ["c1", "c2"];
    let active = ["active"];

    const root = createBlockComponent(() => [
      { key: "history", lines: [...history], persistence: "persistent" },
      { key: "active", lines: [...active], persistence: "volatile" },
    ]);

    const renderer = new TUIRenderer(terminal, root);
    renderer.start();

    history = ["c1"];
    active = ["active2"];
    renderer.forceRender();

    // c2 should remain in scrollback even if the current persistent block shrinks
    expect(sim.lineAt(0)).toBe("c1");
    expect(sim.lineAt(1)).toBe("c2");
    expect(sim.lineAt(2)).toBe("active2");
  });

  test("cursor in volatile block positions correctly", () => {
    const { terminal, sim } = createSim();
    const root = createBlockComponent(() => [
      { key: "history", lines: ["committed"], persistence: "persistent" },
      { key: "active", lines: [`active ${CURSOR_MARKER}text`], persistence: "volatile" },
    ]);

    const renderer = new TUIRenderer(terminal, root);
    renderer.start();

    // Cursor should be at col 7 ("active " = 7 chars) on the active line
    // Active line is at screen row 1
    expect(sim.cursorRow).toBe(1);
    expect(sim.cursorCol).toBe(7);
  });

  test("stop() erases volatile region, leaving persistent lines in scrollback", () => {
    const { terminal, sim } = createSim();
    const root = createBlockComponent(() => [
      { key: "history", lines: ["committed"], persistence: "persistent" },
      { key: "active", lines: ["active"], persistence: "volatile" },
    ]);

    const renderer = new TUIRenderer(terminal, root);
    renderer.start();

    expect(sim.lineAt(0)).toBe("committed");
    expect(sim.lineAt(1)).toBe("active");

    renderer.stop();

    // persistent stays, volatile erased
    expect(sim.lineAt(0)).toBe("committed");
    expect(sim.lineAt(1)).toBe("");
  });
});

describe("Container", () => {
  test("renders children vertically", () => {
    const container = new Container();
    container.addChild(createStaticComponent(["A"]));
    container.addChild(createStaticComponent(["B"]));
    container.addChild(createStaticComponent(["C"]));

    expect(container.render(80)).toEqual(["A", "B", "C"]);
  });

  test("removes child", () => {
    const container = new Container();
    const child = createStaticComponent(["B"]);
    container.addChild(createStaticComponent(["A"]));
    container.addChild(child);
    container.addChild(createStaticComponent(["C"]));

    container.removeChild(child);
    expect(container.render(80)).toEqual(["A", "C"]);
  });

  test("inserts before child", () => {
    const container = new Container();
    const childB = createStaticComponent(["B"]);
    container.addChild(createStaticComponent(["A"]));
    container.addChild(childB);

    container.insertBefore(createStaticComponent(["X"]), childB);
    expect(container.render(80)).toEqual(["A", "X", "B"]);
  });

  test("handles empty children", () => {
    const container = new Container();
    expect(container.render(80)).toEqual([]);
  });

  test("renderBlocks flattens child blocks in order", () => {
    const container = new Container();
    container.addChild(createBlockComponent(() => [{ key: "a", lines: ["A1", "A2"], persistence: "persistent" }]));
    container.addChild(createBlockComponent(() => [{ key: "b", lines: ["B1"], persistence: "persistent" }]));
    container.addChild(createStaticComponent(["C1", "C2"]));

    expect(container.renderBlocks(80)).toEqual([
      { key: "a", lines: ["A1", "A2"], persistence: "persistent" },
      { key: "b", lines: ["B1"], persistence: "persistent" },
      { key: "default", lines: ["C1", "C2"], persistence: "volatile" },
    ]);
  });

  test("delegates handleInput to first child with handler", () => {
    const container = new Container();
    const received: string[] = [];

    container.addChild(createStaticComponent(["no handler"]));
    container.addChild({
      render: () => ["with handler"],
      handleInput: (data: string) => received.push(data),
      invalidate: () => {},
    });

    container.handleInput("x");
    expect(received).toEqual(["x"]);
  });
});
