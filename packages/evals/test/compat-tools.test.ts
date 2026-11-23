// @summary Compatibility probes require provider-side evidence, not an advertised tool or a success message.
import { expect, test } from "bun:test";
import type { ContentBlock } from "@diligent/core/message-contract";
import { getDefaultModelRef } from "@diligent/core/model-registry";
import type { ProviderManager } from "@diligent/core/provider-contract";
import { COMPAT_IMAGE_MODEL, runToolProbe, toolApplicability } from "../src/compat-tools";
import type { ChatGPTEvalAuth } from "../src/providers/chatgpt-oauth";
import type { EvalProfile } from "../src/task";
import { assistantMessage, sequenceStream } from "./helpers/fake-stream";

const profile: EvalProfile = { provider: "chatgpt", model: getDefaultModelRef("chatgpt").modelId, effort: "medium" };
const use: ContentBlock = { type: "provider_tool_use", provider: "chatgpt", id: "s", name: "web_search", input: {} };
const result: Extract<ContentBlock, { type: "web_search_result" }> = {
  type: "web_search_result",
  provider: "chatgpt",
  toolUseId: "s",
  results: [{ url: "https://example.com/news" }],
};

function search(content: ContentBlock[]) {
  const auth = { streamFunction: sequenceStream([assistantMessage(content)]) } as ChatGPTEvalAuth;
  return runToolProbe(profile, "web-search", auth);
}

test("search needs a result from the same provider and tool call, with a usable source", async () => {
  await search([use, result]);
  for (const blocks of [
    [{ type: "text" as const, text: "I searched the web: https://example.com/news" }],
    [use],
    [use, { ...result, toolUseId: "different" }],
    [use, { ...result, provider: "openai" as const }],
    [use, { ...result, results: [] }],
    [use, { ...result, results: [{ url: "not a URL" }] }],
  ]) {
    await expect(search(blocks)).rejects.toThrow();
  }
});

test("image generation is a routed OAuth capability, not an API-key model capability", async () => {
  for (const provider of ["openai", "anthropic", "gemini"] as const) {
    const apiProfile = { ...profile, provider };
    expect(toolApplicability(apiProfile, "web-search")).toBeUndefined();
    expect(toolApplicability(apiProfile, "image-generation")).toContain("OAuth");
    await expect(runToolProbe(apiProfile, "image-generation")).rejects.toThrow("OAuth");
  }
  expect(toolApplicability(profile, "image-generation")).toBeUndefined();
  let requestedModel: string | undefined;
  const auth = {
    bindProviderManager(manager: ProviderManager) {
      manager.setExternalAuth("chatgpt", {
        isConfigured: () => true,
        getStream: () => {
          throw new Error("Unexpected conversation request");
        },
        getImageGeneration:
          () =>
          async ({ model }) => {
            requestedModel = model;
            return { requestedModel: model, mediaType: "image/png", bytes: Uint8Array.of(1, 2, 3) };
          },
      });
    },
  } as ChatGPTEvalAuth;
  await expect(runToolProbe(profile, "image-generation", auth)).rejects.toThrow(/image/i);
  expect(requestedModel).toBe(COMPAT_IMAGE_MODEL);
});
