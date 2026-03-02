// @summary Render SystemSection[] to flat string (OpenAI/Gemini) or Anthropic TextBlockParam[]
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

/**
 * Anthropic text block with optional cache_control.
 * Matches Anthropic SDK's TextBlockParam shape without importing the SDK.
 */
export interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

/**
 * Render sections to Anthropic TextBlockParam[] for structured system messages.
 * Each section becomes its own text block; XML wrapping is applied inline.
 * cache_control is set on blocks that have cacheControl: "ephemeral".
 */
export function toAnthropicBlocks(sections: SystemSection[]): AnthropicTextBlock[] {
  return sections.map((s) => {
    let text: string;
    if (!s.tag) {
      text = s.content;
    } else {
      const attrs = s.tagAttributes
        ? Object.entries(s.tagAttributes)
            .map(([k, v]) => ` ${k}="${v}"`)
            .join("")
        : "";
      text = `<${s.tag}${attrs}>\n${s.content}\n</${s.tag}>`;
    }

    const block: AnthropicTextBlock = { type: "text", text };
    if (s.cacheControl === "ephemeral") {
      block.cache_control = { type: "ephemeral" };
    }
    return block;
  });
}
