// @summary Live compatibility probes for provider-native web search and OAuth image generation.
import { randomUUID } from "node:crypto";
import { validateImage } from "@diligent/core/image-contract";
import { ProviderManager } from "@diligent/core/provider-contract";
import { createWebTool } from "@diligent/runtime/tools";
import { configureProfileProviderManager, createProfileStream, resolveProfileModel } from "./profiles";
import type { ChatGPTEvalAuth } from "./providers/chatgpt-oauth";
import type { EvalProfile } from "./task";

type ToolFeature = "web-search" | "image-generation";

// The image endpoint takes an image model, not the selected conversation model.
export const COMPAT_IMAGE_MODEL = "gpt-image-2.5-sunburst";

const apiTools = {
  "web-search": undefined,
  "image-generation": "Diligent exposes image generation only through the ChatGPT OAuth binding.",
};
const applicability = {
  anthropic: apiTools,
  openai: apiTools,
  gemini: apiTools,
  chatgpt: { "web-search": undefined, "image-generation": undefined },
} satisfies Record<EvalProfile["provider"], Record<ToolFeature, string | undefined>>;

export function toolApplicability(profile: EvalProfile, feature: ToolFeature): string | undefined {
  return applicability[profile.provider][feature];
}

export async function runToolProbe(profile: EvalProfile, feature: ToolFeature, auth?: ChatGPTEvalAuth): Promise<void> {
  const unsupported = toolApplicability(profile, feature);
  if (unsupported) throw new Error(unsupported);

  if (feature === "image-generation") {
    const manager = new ProviderManager({});
    configureProfileProviderManager(profile, manager, auth);
    const { bytes, mediaType } = await manager.generateImage(profile.provider, {
      model: COMPAT_IMAGE_MODEL,
      prompt: "Draw one blue circle on a plain white background.",
    });
    // Independently verify that a consumer can decode the exact returned byte range.
    const buffer = bytes.buffer;
    await validateImage(
      buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && buffer.byteLength === bytes.byteLength
        ? buffer
        : Uint8Array.from(bytes).buffer,
      mediaType,
    );
    return;
  }

  const web = createWebTool().modelExposure;
  if (!web) throw new Error("The runtime web tool has no provider-native exposure.");
  const stream = createProfileStream(profile, process.env, auth)(
    resolveProfileModel(profile),
    {
      systemPrompt: [{ label: "base", content: "Use the native web search tool to answer the question." }],
      messages: [
        {
          role: "user",
          timestamp: Date.now(),
          content: "Search the web now for the latest stable Python release. Report its version and the source URL.",
        },
      ],
      tools: [web],
    },
    { sessionId: randomUUID(), effort: profile.effort, signal: AbortSignal.timeout(120_000) },
  );
  const { message } = await stream.result();
  if (message.stopReason !== "end_turn") throw new Error(`Web search stopped with ${message.stopReason}.`);
  const callIds = new Set<string>();
  for (const block of message.content) {
    if (block.type === "provider_tool_use" && block.provider === profile.provider && block.name === "web_search") {
      callIds.add(block.id);
    }
  }
  for (const block of message.content) {
    if (block.type !== "web_search_result" || block.provider !== profile.provider || !callIds.has(block.toolUseId)) {
      continue;
    }
    if (block.error) throw new Error(`Provider web search failed: ${block.error.code}`);
    if (block.results.some(({ url }) => /^https?:\/\//i.test(url) && URL.canParse(url))) return;
  }
  throw new Error("No provider-native search call returned a matching result with a web source.");
}
