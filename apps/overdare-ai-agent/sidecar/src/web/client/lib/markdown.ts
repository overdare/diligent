// @summary Marked wrapper with highlight.js syntax highlighting for code blocks
import hljs from "highlight.js";
import { marked, type Renderer } from "marked";
import { markedHighlight } from "marked-highlight";
import { type FileLinkOptions, toFilePreviewUrl } from "../../shared/file-routes";
import { toWebImageUrl } from "../../shared/image-routes";

const renderer = new marked.Renderer();
const IMAGE_GALLERY_ICON = `<svg class="image-gallery-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <rect x="7" y="3" width="13" height="13" rx="2.5" stroke="currentColor" stroke-width="1.6"/>
  <path d="m9.5 13 2.7-2.7 2.2 2.2 1.6-1.6 2.5 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="15.5" cy="7.5" r="1.25" fill="currentColor"/>
  <rect x="3" y="7" width="13" height="13" rx="2.5" stroke="currentColor" stroke-width="1.6"/>
  <path d="m5.5 17 2.7-2.7 2.2 2.2 1.6-1.6 1.5 1.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="11.5" cy="11.5" r="1.25" fill="currentColor"/>
</svg>`;
const renderImage = renderer.image;
renderer.image = function (token) {
  const image = renderImage.call(this, {
    ...token,
    href: /^(?:[a-z][a-z0-9+.-]*:\/\/|\/\/)/i.test(token.href) ? token.href : toWebImageUrl(token.href),
  });
  return `<span class="image-gallery markdown-image-preview" data-image-preview="true">
    <button type="button" class="image-gallery-toggle" data-image-toggle="true" aria-expanded="true">${IMAGE_GALLERY_ICON} 1 image <span aria-hidden="true" data-image-chevron="true">⌄</span></button>
    <button type="button" class="image-thumbnail" data-image-open="true" aria-label="${escapeHtml(`View ${token.text || "image"}`)}">${image}</button>
  </span>`;
};

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}

function normalizeCodeLanguage(lang: string | undefined): string {
  return lang?.trim().split(/\s+/, 1)[0] || "text";
}

const COPY_CODE_ICON = `
<svg class="code-block__copy-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <rect x="5.25" y="2.75" width="7.5" height="8.5" rx="1.25" stroke="currentColor" stroke-width="1.5"/>
  <path d="M3.75 5.25H3.5C2.81 5.25 2.25 5.81 2.25 6.5v6c0 .69.56 1.25 1.25 1.25h5c.69 0 1.25-.56 1.25-1.25v-.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>
`.trim();

const COPY_SUCCESS_ICON = `
<svg class="code-block__check-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
  <path d="m3.25 8.25 3 3 6.5-6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`.trim();

export interface MarkdownOptions extends FileLinkOptions {
  /** File content is untrusted: display raw HTML as text. */
  safeHtml?: boolean;
}

function createRenderer(options: MarkdownOptions): Renderer {
  const configured = Object.assign(new marked.Renderer(), renderer);
  configured.link = function ({ href, title, tokens, text }) {
    const label = tokens?.length ? this.parser.parseInline(tokens) : escapeHtml(text);
    const normalizedHref = href.trim().replace(/[\u0000-\u0020]/g, "");
    if (/^(?:javascript|vbscript|data):/i.test(normalizedHref)) return label;
    const safeHref = escapeHtml(toFilePreviewUrl(href, options));
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${safeHref}"${titleAttr} class="prose-link" target="_blank" rel="noopener noreferrer">${label}</a>`;
  };
  if (options.safeHtml) {
    configured.html = ({ text }) => escapeHtml(text);
    configured.image = ({ href, text }) => {
      const title = escapeHtml(text || "Image");
      const target = toFilePreviewUrl(href, options);
      if (target !== href) {
        return `<a href="${escapeHtml(target)}" target="_blank" rel="noopener noreferrer">${title}</a>`;
      }
      if (!/^(?:https?:\/\/|\/\/|\/_diligent\/image\/)/i.test(href)) return title;
      return `<img src="${escapeHtml(href)}" alt="${title}" loading="lazy" />`;
    };
  }
  return configured;
}

renderer.code = ({ text, lang, escaped }) => {
  const language = normalizeCodeLanguage(lang);
  const escapedLanguage = escapeHtml(language);
  const languageClass = language.replace(/[^a-zA-Z0-9_+-]/g, "-");
  const renderedCode = escaped ? text.replace(/\n$/, "") : escapeHtml(text.replace(/\n$/, ""));
  const copyLabel = escapeHtml(`Copy ${language} code`);

  return `<div class="code-block">
  <div class="code-block__header">
    <span class="code-block__language">${escapedLanguage}</span>
    <button
      type="button"
      class="code-block__copy-button"
      data-code-copy-button="true"
      data-copied="false"
      data-copy-label="${copyLabel}"
      aria-label="${copyLabel}"
      title="Copy code"
    >
      ${COPY_CODE_ICON}
      ${COPY_SUCCESS_ICON}
    </button>
  </div>
  <pre><code class="language-${languageClass}">${renderedCode}</code></pre>
</div>
`;
};

marked.use(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value;
    },
  }),
);

marked.setOptions({
  breaks: false,
  gfm: true,
  renderer,
});

export function renderMarkdown(text: string, options: MarkdownOptions = {}): string {
  return marked.parse(text, { renderer: createRenderer(options) }) as string;
}

export function renderInlineMarkdown(text: string, options: MarkdownOptions = {}): string {
  return marked.parseInline(text, { renderer: createRenderer(options) }) as string;
}
