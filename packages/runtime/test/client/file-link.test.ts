// @summary Shared file-link classification preserves local paths without capturing web URLs
import { expect, test } from "bun:test";
import { parseFileLink } from "../../src/client/file-link";

test.each([
  ["docs/README.md", "docs/README.md"],
  ["./docs/README.md", "./docs/README.md"],
  ["../README.md", "../README.md"],
  ["/repo/docs/README.md", "/repo/docs/README.md"],
  ["C:/Users/test/README.md", "C:/Users/test/README.md"],
  ["C://Users/test/README.md", "C:/Users/test/README.md"],
  ["C:\\Users\\test\\README.md", "C:/Users/test/README.md"],
  ["file:///C:/Users/test/a%20b.md", "C:/Users/test/a b.md"],
  ["file:///repo/a%20b.md", "/repo/a b.md"],
  ["file://localhost/repo/a.md", "/repo/a.md"],
  ["docs/100%25%20%231%3F.md", "docs/100% #1?.md"],
])("parses local reference %s", (href, path) => {
  expect(parseFileLink(href)).toMatchObject({ path });
});

test.each([
  "https://example.com",
  "http://localhost:7433",
  "//example.com/path",
  "mailto:a@b.com",
  "#heading",
  "?query=value",
  "javascript:alert(1)",
  "data:text/html,test",
  "file://remote/share/file.md",
  "",
])("does not classify %s as a local file", (href) => {
  expect(parseFileLink(href)).toBeNull();
});

test("keeps document fragments separate from the file path", () => {
  expect(parseFileLink("docs/a.md#heading")).toEqual({ path: "docs/a.md", fragment: "heading" });
});

test("rejects embedded control characters instead of emitting a navigation", () => {
  expect(parseFileLink("docs/a\u0000.md")).toBeNull();
  expect(parseFileLink("docs/a%00.md")).toBeNull();
});
