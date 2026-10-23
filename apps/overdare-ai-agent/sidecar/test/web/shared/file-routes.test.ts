// @summary File preview URLs preserve paths, document-relative navigation, and thread scope
import { expect, test } from "bun:test";
import { buildFilePreviewUrl, toFilePreviewUrl } from "../../../src/web/shared/file-routes";

test("encodes generated local links instead of resolving them against the website", () => {
  expect(toFilePreviewUrl("docs/README.md", { threadId: "thread-1" })).toBe(
    "/_diligent/file?path=docs%2FREADME.md&threadId=thread-1",
  );
  expect(toFilePreviewUrl("C://Users/test/README.md")).toBe("/_diligent/file?path=C%3A%2FUsers%2Ftest%2FREADME.md");
});

test("preserves exact decoded filenames through query-string encoding", () => {
  const path = "/repo/a 100% #? café.md";
  const url = new URL(buildFilePreviewUrl(path), "http://localhost");
  expect(url.searchParams.get("path")).toBe(path);
});

test("nested document links keep the document directory and originating thread", () => {
  expect(toFilePreviewUrl("../other.md#heading", { basePath: "/repo/docs/README.md", threadId: "thread-1" })).toBe(
    "/_diligent/file?path=%2Frepo%2Fdocs%2F..%2Fother.md&threadId=thread-1#heading",
  );
  expect(toFilePreviewUrl("next.md", { basePath: "C:/project/docs/README.md" })).toBe(
    "/_diligent/file?path=C%3A%2Fproject%2Fdocs%2Fnext.md",
  );
});

test("keeps web URLs, internal preview routes, existing image routes, and anchors intact", () => {
  for (const href of [
    "https://example.com",
    "//example.com/a",
    "#section",
    "/_diligent/file?path=README.md",
    "/_diligent/image/shot.png",
  ]) {
    expect(toFilePreviewUrl(href)).toBe(href);
  }
});

test.each([
  "hello%20world",
  "%ED%95%9C%EA%B8%80",
  "100%25",
])("preserves the encoded fragment %s exactly once", (fragment) => {
  expect(toFilePreviewUrl(`docs/a.md#${fragment}`)).toBe(`/_diligent/file?path=docs%2Fa.md#${fragment}`);
});
