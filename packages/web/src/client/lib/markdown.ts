// @summary Marked wrapper for rendering agent output as safe HTML

import { marked } from "marked";

marked.setOptions({ breaks: true });

export function renderMarkdown(text: string): string {
  return marked.parse(text) as string;
}
