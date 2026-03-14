// @summary Render SystemSection[] to a flat string for providers that accept a plain system prompt
import type { SystemSection } from "./types";

/**
 * Render sections to a single string for providers that accept a plain system prompt.
 * Wraps each section in its XML tag (if set), joins with double newline.
 */
export function flattenSections(sections: SystemSection[]): string {
  return sections
    .map((s) => {
      if (!s.tag) return s.content;
      const attrs = s.tagAttributes
        ? Object.entries(s.tagAttributes)
            .map(([k, v]) => ` ${k}="${v}"`)
            .join("")
        : "";
      return `<${s.tag}${attrs}>\n${s.content}\n</${s.tag}>`;
    })
    .join("\n\n");
}
