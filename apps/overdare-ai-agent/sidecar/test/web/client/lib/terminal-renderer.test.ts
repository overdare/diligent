// @summary Regression coverage for terminal replay, resize, and replacement parse ordering.
import { expect, test } from "bun:test";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/headless";
import { TerminalRenderer } from "../../../../src/web/client/lib/terminal-renderer";

const contents = (terminal: Terminal) =>
  Array.from({ length: terminal.buffer.active.length }, (_, i) =>
    terminal.buffer.active.getLine(i)?.translateToString(true),
  ).join("\n");

test("a replacement reset cannot retain queued output from the previous session", async () => {
  const terminal = new Terminal({ cols: 30, rows: 6, allowProposedApi: true });
  const renderer = new TerminalRenderer(terminal);
  try {
    renderer.write("OLD_SESSION".repeat(5000));
    renderer.reset(30, 6);
    renderer.write("NEW_SESSION");
    await new Promise<void>((resolve) => renderer.afterWrite(resolve));
    expect(contents(terminal)).toContain("NEW_SESSION");
    expect(contents(terminal).includes("OLD_SESSION")).toBe(false);
  } finally {
    renderer.dispose();
    terminal.dispose();
  }
});

test("replay parses at its recorded dimensions before an authoritative resize", async () => {
  const options = { cols: 10, rows: 3, allowProposedApi: true, windowsPty: { backend: "conpty" as const } };
  const terminal = new Terminal(options);
  const expected = new Terminal(options);
  const renderer = new TerminalRenderer(terminal);
  const source = new Terminal(options);
  const serializer = new SerializeAddon();
  source.loadAddon(serializer);
  try {
    await new Promise<void>((resolve) => source.write("AAAAAAAAAA\r\nBBBBBBBBBB\r\nCCC\x1b[2;6H", resolve));
    const snapshot = serializer.serialize();
    await new Promise<void>((resolve) => expected.write(snapshot, resolve));
    expected.resize(6, 3);
    renderer.reset(10, 3);
    renderer.write(snapshot);
    renderer.resize(6, 3);
    await new Promise<void>((resolve) => renderer.afterWrite(resolve));
    expect(contents(terminal)).toBe(contents(expected));
    expect(terminal.buffer.active.cursorX).toBe(expected.buffer.active.cursorX);
    expect(terminal.buffer.active.cursorY).toBe(expected.buffer.active.cursorY);
    expect(terminal.buffer.active.baseY).toBe(expected.buffer.active.baseY);
  } finally {
    renderer.dispose();
    terminal.dispose();
    expected.dispose();
    source.dispose();
  }
});
