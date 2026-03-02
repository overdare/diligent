// @summary Markdown renderer using dangerouslySetInnerHTML with prose styles

import { renderMarkdown } from "../lib/markdown";

interface MarkdownContentProps {
  text: string;
}

export function MarkdownContent({ text }: MarkdownContentProps) {
  return (
    <div
      className="prose-content"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: agent output only — external input echoing requires DOMPurify
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
}
