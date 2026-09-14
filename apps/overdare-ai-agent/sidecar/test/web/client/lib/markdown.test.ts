// @summary Markdown HTML contracts for fenced code-block controls
import { expect, test } from "bun:test";
import { renderMarkdown } from "../../../../src/web/client/lib/markdown";

test("generated-image Markdown uses the Web route instead of the host volume path", () => {
  const html = renderMarkdown(
    '![생성된 사진](/Volumes/overdare-newgame/.overdare/images/generated/photo.png "Generated photo")',
  );
  expect(html).toContain('src="/_diligent/image/generated/photo.png"');
  expect(html).toContain('alt="생성된 사진"');
  expect(html).toContain('title="Generated photo"');
  expect(html).not.toContain("/Volumes/");
  expect(html).toContain('class="image-gallery-icon"');
});

test("image Markdown encodes local paths and preserves remote and existing route URLs", () => {
  expect(renderMarkdown("![photo](<.overdare/images/generated/photo 1.png>)")).toContain(
    'src="/_diligent/image/generated/photo%201.png"',
  );
  for (const url of ["https://example.com/photo.png", "/_diligent/image/generated/photo.png"]) {
    expect(renderMarkdown(`![photo](${url})`)).toContain(`src="${url}"`);
  }
});

test("fenced code renders a language header and accessible copy control", () => {
  const html = renderMarkdown("```ts\nconst value = 1;\n```");

  expect(html).toContain('class="code-block"');
  expect(html).toContain('class="code-block__header"');
  expect(html).toContain('class="code-block__language">ts</span>');
  expect(html).toContain('data-code-copy-button="true"');
  expect(html).toContain('data-copied="false"');
  expect(html).toContain('aria-label="Copy ts code"');
  expect(html).toContain('class="language-ts"');
  expect(html).toContain("hljs-keyword");
});
