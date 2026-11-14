// @summary Tests for markdown view rendering and scrolling
import { describe, expect, test } from "bun:test";
import { MarkdownView } from "../../../src/tui/components/markdown-view";

describe("MarkdownView", () => {
  test("returns empty for no content", () => {
    const mv = new MarkdownView(() => {});
    expect(mv.render(80)).toEqual([]);
  });

  test("hides trailing buffer until newline commit", () => {
    const mv = new MarkdownView(() => {});
    mv.pushDelta("Hello ");
    expect(mv.render(80)).toEqual([]);

    mv.pushDelta("world\n");
    expect(mv.render(80).join("")).toContain("world");

    mv.finalize();
    const afterFinalize = mv.render(80);
    expect(afterFinalize.join("")).toContain("Hello");
    expect(afterFinalize.join("")).toContain("world");
  });

  test("keeps trailing buffer hidden without a byte threshold", () => {
    const mv = new MarkdownView(() => {});
    mv.pushDelta("a".repeat(32));
    expect(mv.render(80)).toEqual([]);
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

  test("renders markdown only after trailing buffer is finalized", () => {
    const mv = new MarkdownView(() => {});
    mv.pushDelta("x".repeat(1024));
    mv.pushDelta(" **bold**");
    expect(mv.render(80)).toEqual([]);

    mv.finalize();

    const lines = mv.render(80).join(" ");
    expect(lines).toContain("bold");
    expect(lines).not.toContain("**bold**");
  });
});
