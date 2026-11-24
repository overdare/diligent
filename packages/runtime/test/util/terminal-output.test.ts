// @summary Tests for turning pseudo-terminal output into plain text across arbitrary chunk boundaries

import { describe, expect, test } from "bun:test";
import { TerminalTextDecoder } from "../../src/util/terminal-output";

const encoder = new TextEncoder();

function decode(...chunks: string[]): string {
  const decoder = new TerminalTextDecoder();
  return chunks.map((chunk) => decoder.write(encoder.encode(chunk))).join("") + decoder.end();
}

describe("TerminalTextDecoder", () => {
  test("removes colors, cursor movement, titles, hyperlinks, and charset switches", () => {
    const raw =
      "\x1b[1;31mred\x1b[0m \x1b[2K\x1b[?25lhidden-cursor\x1b[?25h\x1b]0;title\x07" +
      "\x1b]8;;https://example.test\x1b\\link\x1b]8;;\x1b\\ \x1b(Bascii\x1b=\x1bPdevice\x1b\\done";
    expect(decode(raw)).toBe("red hidden-cursorlink asciidone");
  });

  test("turns terminal line endings into newlines and drops other control characters", () => {
    expect(decode("one\r\ntwo\r\r\nbell\x07\tback\bspace\x7f\r\n")).toBe("one\ntwo\nbell\tbackspace\n");
  });

  test("starts a new line at a lone carriage return instead of overwriting earlier output", () => {
    expect(decode("progress 10%\rprogress 100%\r\ndone")).toBe("progress 10%\nprogress 100%\ndone");
    expect(decode("tail\r")).toBe("tail\n");
  });

  test("produces the same text however the stream is split", () => {
    const raw = "a\x1b[38;5;196mb\x1b]0;t\x1b\\c\r\nd\re🙂\x1b(Bf\r";
    const whole = decode(raw);
    expect(whole).toBe("abc\nd\ne🙂f\n");
    const bytes = encoder.encode(raw);
    for (let split = 1; split < bytes.length; split++) {
      const decoder = new TerminalTextDecoder();
      const text = decoder.write(bytes.slice(0, split)) + decoder.write(bytes.slice(split)) + decoder.end();
      expect(text).toBe(whole);
    }
  });

  test("returns text before a split sequence immediately and drops a sequence the stream never finishes", () => {
    const decoder = new TerminalTextDecoder();
    expect(decoder.write(encoder.encode("prompt> \x1b[3"))).toBe("prompt> ");
    expect(decoder.end()).toBe("");
  });
});
