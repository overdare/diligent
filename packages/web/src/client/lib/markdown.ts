// @summary Marked wrapper with highlight.js syntax highlighting for code blocks
import hljs from "highlight.js";
import { marked } from "marked";
import { markedHighlight } from "marked-highlight";

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

marked.setOptions({ breaks: true });

export function renderMarkdown(text: string): string {
  return marked.parse(text) as string;
}
