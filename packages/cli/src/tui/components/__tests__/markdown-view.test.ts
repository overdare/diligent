// @summary Tests for markdown view rendering and scrolling
import { describe, expect, test } from "bun:test";
import { MarkdownView } from "../markdown-view";

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("MarkdownView", () => {
  test("returns empty for no content", () => {
    const mv = new MarkdownView(() => {});
    expect(mv.render(80)).toEqual([]);
  });

  test("renders small trailing buffer immediately", () => {
    const mv = new MarkdownView(() => {});
    mv.pushDelta("Hello ");
    const beforeNewline = mv.render(80);
    expect(beforeNewline.join("")).toContain("Hello");

    mv.pushDelta("world\n");
    expect(mv.render(80).join("")).toContain("world");

    mv.finalize();
    const afterFinalize = mv.render(80);
    expect(afterFinalize.join("")).toContain("Hello");
    expect(afterFinalize.join("")).toContain("world");
  });

  test("renders streaming content without a byte threshold", () => {
    const mv = new MarkdownView(() => {});
    mv.pushDelta("a".repeat(32));
    const lines = mv.render(80);
    expect(lines.length).toBeGreaterThan(0);
    expect(stripAnsi(lines.join(""))).toContain("a");
  });

  test("finalize renders remaining content", () => {
    const mv = new MarkdownView(() => {});
    mv.pushDelta("trailing text");
    mv.finalize();
    expect(mv.render(80).join("")).toContain("trailing text");
  });

  test("reset clears all state", () => {
    const mv = new MarkdownView(() => {});
    mv.pushDelta("hello\n");
    mv.reset();
    expect(mv.render(80)).toEqual([]);
  });

  test("handles multiple lines correctly", () => {
    const mv = new MarkdownView(() => {});
    mv.pushDelta("line 1\nline 2\n");
    mv.finalize();
    const lines = mv.render(80);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const text = lines.join(" ");
    expect(text).toContain("line 1");
    expect(text).toContain("line 2");
  });

  test("requestRender is called when a complete line is committed", () => {
    let renderCount = 0;
    const mv = new MarkdownView(() => {
      renderCount++;
    });
    mv.pushDelta("x".repeat(200));
    expect(renderCount).toBe(0);
    mv.pushDelta("\n");
    expect(renderCount).toBe(1);
  });

  test("requestRender is called on finalize", () => {
    let renderCount = 0;
    const mv = new MarkdownView(() => {
      renderCount++;
    });
    mv.pushDelta("hello");
    mv.finalize();
    expect(renderCount).toBe(1);
  });

  test("renders markdown in trailing buffer during streaming", () => {
    const mv = new MarkdownView(() => {});
    mv.pushDelta("x".repeat(1024));
    mv.pushDelta(" **bold**");
    const lines = mv.render(80).join(" ");
    expect(lines).toContain("bold");
    expect(lines).not.toContain("**bold**");
  });
});
