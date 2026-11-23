// @summary Anthropic request-level API version, API-key header, and system section conversion
import type { SystemSection } from "../../types";

/** The API version SDK 1.x sends; raw-fetch requests send the same so every Anthropic path follows one contract. */
export const ANTHROPIC_API_VERSION = "2026-10-21";

/**
 * SDK 1.x sends an API key as `Authorization: Bearer`. These default headers keep it in `X-Api-Key`, where
 * the raw-fetch paths send it and where gateways behind a custom base URL may read it. The API accepts both.
 */
export function anthropicApiKeyHeaders(apiKey: string): { "X-Api-Key": string; Authorization: null } {
  return { "X-Api-Key": apiKey, Authorization: null };
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export function toAnthropicBlocks(sections: SystemSection[]): AnthropicTextBlock[] {
  return sections.map((section, index) => {
    const attrs = section.tagAttributes
      ? Object.entries(section.tagAttributes)
          .map(([key, value]) => ` ${key}="${value}"`)
          .join("")
      : "";
    const rendered = section.tag ? `<${section.tag}${attrs}>\n${section.content}\n</${section.tag}>` : section.content;
    const text = index < sections.length - 1 ? `${rendered}\n\n` : rendered;
    return {
      type: "text",
      text,
      ...(section.cacheControl === "ephemeral" ? { cache_control: { type: "ephemeral" as const } } : {}),
    };
  });
}
