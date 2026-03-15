// @summary Tests for markdown rendering with ANSI formatting
import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../src/tui/markdown";
import { t } from "../src/tui/theme";

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("renderMarkdown", () => {
  test("renders bold text with ANSI", () => {
    const result = renderMarkdown("**bold text**", 80);
    expect(result).toContain("\x1b[1m");
    expect(result).toContain("bold text");
    expect(result).toContain("\x1b[22m");
  });

  test("renders italic text with ANSI", () => {
    const result = renderMarkdown("*italic text*", 80);
    expect(result).toContain("\x1b[3m");
    expect(result).toContain("italic text");
    expect(result).toContain("\x1b[23m");
  });

  test("renders inline code with theme info color", () => {
    const result = renderMarkdown("`some code`", 80);
    expect(result).toContain(t.info);
    expect(result).toContain("some code");
  });

  test("renders code blocks with indentation", () => {
    const result = renderMarkdown("```ts\nconst x = 1;\n```", 80);
    expect(result).toContain("const x = 1");
    expect(result).toContain("[ts]");
  });

  test("renders level-1 headers with bold+underline", () => {
    const result = renderMarkdown("# Header", 80);
    expect(result).toContain("\x1b[1m");
    expect(result).toContain("\x1b[4m");
    expect(result).toContain("Header");
  });

  test("renders level-2 headers as bold only", () => {
    const result = renderMarkdown("## Header 2", 80);
    expect(result).toContain("\x1b[1m");
    expect(result).toContain("Header 2");
  });

  test("renders unordered lists with dash markers", () => {
    const result = renderMarkdown("- item one\n- item two", 80);
    expect(result).toContain("- item one");
    expect(result).toContain("- item two");
    expect(result).not.toContain("•");
  });

  test("renders ordered list markers", () => {
    const result = renderMarkdown("1. First\n2. Second\n3. Third", 80);
    expect(result).toContain("1. First");
    expect(result).toContain("2. Second");
    expect(result).toContain("3. Third");
  });

  test("keeps continuation indentation for wrapped bullet items", () => {
    const source = "- This bullet line is intentionally long so it wraps on narrow terminal widths.";
    const result = stripAnsi(renderMarkdown(source, 24));
    const lines = result.split("\n").filter((line) => line.length > 0);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]?.startsWith("- ")).toBe(true);
    expect(lines[1]?.startsWith("  ")).toBe(true);
    expect(lines[1]?.startsWith("- ")).toBe(false);
  });

  test("keeps continuation indentation for wrapped ordered items", () => {
    const source = "12. This ordered item is long enough to wrap and should align after the numeric marker.";
    const result = stripAnsi(renderMarkdown(source, 24));
    const lines = result.split("\n").filter((line) => line.length > 0);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]?.startsWith("12. ")).toBe(true);
    expect(lines[1]?.startsWith("    ")).toBe(true);
    expect(lines[1]?.startsWith("12. ")).toBe(false);
  });

  test("renders task list checkboxes", () => {
    const result = renderMarkdown("- [x] done\n- [ ] todo", 80);
    expect(result).toContain("[x] done");
    expect(result).toContain("[ ] todo");
  });

  test("renders nested list without falling back to raw markdown", () => {
    const source = "1. First item\n2. Second item\n   - Nested bullet A\n   - Nested bullet B\n";
    const result = renderMarkdown(source, 80);
    expect(result).not.toBe(source);
    expect(result).toContain("1. First item");
    expect(result).toContain("Nested bullet A");
    expect(result).not.toContain("2. Second item\n   - Nested bullet A");
  });

  test("renders second-level bullets on separate lines", () => {
    const source = "- 사과\n- 바나나\n  - 바나나-1\n  - 바나나-2\n- 오렌지";
    const result = stripAnsi(renderMarkdown(source, 80));

    expect(result).toContain("- 사과");
    expect(result).toContain("- 바나나\n");
    expect(result).toContain("- 바나나-1\n");
    expect(result).toContain("- 바나나-2");
    expect(result).toContain("- 오렌지");
    expect(result).not.toContain("바나나  - 바나나-1");
  });

  test("renders bold formatting inside nested bullet items", () => {
    const source = "- **Principles**\n  - **Effortless continuity**\n  - **Project-centric**";
    const result = renderMarkdown(source, 80);

    expect(result).toContain("\x1b[1mPrinciples\x1b[22m");
    expect(result).toContain("\x1b[1mEffortless continuity\x1b[22m");
    expect(result).not.toContain("**Principles**");
    expect(result).not.toContain("**Effortless continuity**");
  });

  test("renders table with box drawing characters", () => {
    const source = "| Left | Center | Right |\n| :--- | :----: | ----: |\n| a | b | c |";
    const result = renderMarkdown(source, 80);
    expect(result).toContain("┌");
    expect(result).toContain("┬");
    expect(result).toContain("│");
    expect(result).toContain("Left");
    expect(result).toContain("Center");
    expect(result).toContain("Right");
  });

  test("renders links with hidden URL label", () => {
    const result = renderMarkdown("[click here](https://example.com)", 80);
    expect(result).toContain("click here");
    expect(result).not.toContain("(https://example.com)");
  });

  test("renders links with terminal hyperlink escape sequences", () => {
    const result = renderMarkdown("[click here](https://example.com)", 80);
    expect(result).toContain("\u001b]8;;https://example.com\u0007");
    expect(result).toContain("\u001b]8;;\u0007");
  });

  test("renders bare links as clickable hyperlinks", () => {
    const result = renderMarkdown("https://example.com", 80);
    expect(result).toContain("\u001b]8;;https://example.com\u0007");
    expect(result).toContain("https://example.com");
  });

  test("renders images with alt text and hidden URL", () => {
    const result = renderMarkdown("![logo](https://example.com/logo.png)", 80);
    expect(result).toContain("logo");
    expect(result).toContain("\u001b]8;;https://example.com/logo.png\u0007");
    expect(result).not.toContain("(https://example.com/logo.png)");
  });

  test("renders GitHub-style alerts", () => {
    const source = "[!NOTE]\nUseful information.\n\n[!WARNING]\nBe careful.";
    const result = renderMarkdown(source, 80);
    expect(result).toContain("NOTE");
    expect(result).toContain("WARNING");
    expect(result).toContain("Useful information.");
    expect(result).toContain("Be careful.");
  });

  test("renders footnotes with inline reference and footer section", () => {
    const source = "Here is a sentence with a footnote[^1].\n\n[^1]: Footnote content.";
    const result = renderMarkdown(source, 80);
    const plain = stripAnsi(result);
    expect(plain).toContain("Here is a sentence with a footnote");
    expect(plain).toContain("Footnotes");
    expect(plain).toContain("Footnote content.");
    expect(plain).not.toContain("[^1]:");
  });

  test("renders details blocks as expandable-like section", () => {
    const source = "<details><summary>More info</summary>\nHidden content\n</details>";
    const result = renderMarkdown(source, 80);
    expect(result).toContain("▸ More info");
    expect(result).toContain("Hidden content");
    expect(result).not.toContain("<details>");
  });

  test("handles plain text without errors", () => {
    const result = renderMarkdown("just plain text", 80);
    expect(result).toContain("just plain text");
  });

  test("handles partial/incomplete markdown gracefully", () => {
    const result = renderMarkdown("**unclosed bold", 80);
    // Should not throw, should contain the text
    expect(result).toContain("unclosed bold");
  });

  test("handles empty string", () => {
    const result = renderMarkdown("", 80);
    expect(result).toBe("");
  });
});
