// @summary Tests for stdin buffer read and escape sequence parsing
import { describe, expect, test } from "bun:test";
import { StdinBuffer } from "../../../src/tui/framework/stdin-buffer";

describe("StdinBuffer", () => {
  const createBuffer = () => new StdinBuffer();

  test("splits single characters", () => {
    const buf = createBuffer();
    expect(buf.split("abc")).toEqual(["a", "b", "c"]);
  });

  test("splits escape sequences", () => {
    const buf = createBuffer();
    expect(buf.split("\x1b[A\x1b[B")).toEqual(["\x1b[A", "\x1b[B"]);
  });

  test("splits mixed input", () => {
    const buf = createBuffer();
    expect(buf.split("a\x1b[Ab")).toEqual(["a", "\x1b[A", "b"]);
  });

  test("handles control characters", () => {
    const buf = createBuffer();
    expect(buf.split("\x03\x04")).toEqual(["\x03", "\x04"]);
  });

  test("handles empty input", () => {
    const buf = createBuffer();
    expect(buf.split("")).toEqual([]);
  });

  test("handles single character", () => {
    const buf = createBuffer();
    expect(buf.split("x")).toEqual(["x"]);
  });

  test("handles SS3 sequences (ESC O)", () => {
    const buf = createBuffer();
    expect(buf.split("\x1bOA\x1bOB")).toEqual(["\x1bOA", "\x1bOB"]);
  });

  test("handles CSI sequences with parameters", () => {
    const buf = createBuffer();
    expect(buf.split("\x1b[1;2A")).toEqual(["\x1b[1;2A"]);
  });

  test("handles Kitty protocol sequences", () => {
    const buf = createBuffer();
    expect(buf.split("\x1b[13;2u")).toEqual(["\x1b[13;2u"]);
  });

  test("handles xterm/windows extended key sequences", () => {
    const buf = createBuffer();
    expect(buf.split("\x1b[27;2;13~")).toEqual(["\x1b[27;2;13~"]);
  });

  test("handles Alt+key (ESC + char)", () => {
    const buf = createBuffer();
    expect(buf.split("\x1ba")).toEqual(["\x1ba"]);
  });

  test("handles delete key sequence", () => {
    const buf = createBuffer();
    expect(buf.split("\x1b[3~")).toEqual(["\x1b[3~"]);
  });

  test("buffers lone escape at end of input until next chunk", () => {
    const buf = createBuffer();
    expect(buf.split("a\x1b")).toEqual(["a"]);
    expect(buf.split("[A")).toEqual(["\x1b[A"]);
  });

  test("handles complex mixed input", () => {
    const buf = createBuffer();
    const input = "hello\x1b[A\x03world\x1b[B";
    const result = buf.split(input);
    expect(result).toEqual(["h", "e", "l", "l", "o", "\x1b[A", "\x03", "w", "o", "r", "l", "d", "\x1b[B"]);
  });

  test("captures bracketed paste as a single sequence", () => {
    const buf = createBuffer();
    const payload = "line 1\nline 2\nline 3";
    const input = `\x1b[200~${payload}\x1b[201~`;
    expect(buf.split(input)).toEqual([input]);
  });

  test("captures bracketed paste even when preceded/followed by text", () => {
    const buf = createBuffer();
    const input = "a\x1b[200~hello\nworld\x1b[201~b";
    expect(buf.split(input)).toEqual(["a", "\x1b[200~hello\nworld\x1b[201~", "b"]);
  });

  test("handles bracketed paste split across chunks", () => {
    const buf = createBuffer();
    expect(buf.split("\x1b[200~hello\n")).toEqual([]);
    expect(buf.split("world\x1b[201~")).toEqual(["\x1b[200~hello\nworld\x1b[201~"]);
  });

  test("treats plain multiline chunks as paste fallback", () => {
    const buf = createBuffer();
    expect(buf.split("line 1\nline 2")).toEqual(["\x1b[200~line 1\nline 2\x1b[201~"]);
  });

  test("does not treat single trailing newline as paste fallback", () => {
    const buf = createBuffer();
    expect(buf.split("hello\n")).toEqual(["h", "e", "l", "l", "o", "\n"]);
  });

  test("treats single embedded newline as paste fallback", () => {
    const buf = createBuffer();
    expect(buf.split("hello\nworld")).toEqual(["\x1b[200~hello\nworld\x1b[201~"]);
  });
});
