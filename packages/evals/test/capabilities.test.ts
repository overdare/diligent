// @summary Capability support classification and the catalog cost policy

import { describe, expect, test } from "bun:test";
import { listModels } from "@diligent/core/model-registry";
import { capabilitySupport, createCapabilityCostPolicy, EXPENSIVE_INPUT_COST_PER_1M } from "../src/capabilities";

describe("createCapabilityCostPolicy", () => {
  const expensive = EXPENSIVE_INPUT_COST_PER_1M;
  const policy = createCapabilityCostPolicy([
    { provider: "anthropic", modelId: "newest-expensive", inputCostPer1M: expensive * 2 },
    { provider: "anthropic", modelId: "cheap", inputCostPer1M: expensive / 4 },
    { provider: "anthropic", modelId: "older-expensive", inputCostPer1M: expensive },
    { provider: "chatgpt", modelId: "subscription" },
  ]);

  test("runs only the newest expensive model per provider, without compaction", () => {
    const anthropic = (modelId: string) => ({ provider: "anthropic" as const, modelId });
    expect(policy(anthropic("newest-expensive"), "web_search")).toBeUndefined();
    expect(policy(anthropic("newest-expensive"), "compaction")).toContain("skip compaction");
    expect(policy(anthropic("older-expensive"), "basic_response")).toContain("(newest-expensive)");
    expect(policy(anthropic("cheap"), "compaction")).toBeUndefined();
  });

  test("models without a token price, such as subscriptions, are never skipped", () => {
    expect(policy({ provider: "chatgpt", modelId: "subscription" }, "compaction")).toBeUndefined();
  });
});

describe("capabilitySupport", () => {
  test("image generation is offered only on the ChatGPT OAuth path", () => {
    for (const provider of ["openai", "anthropic", "gemini"] as const)
      for (const model of listModels(provider))
        expect(capabilitySupport(model, "image_generation").supported, `${provider}/${model.modelId}`).toBe(false);
    for (const model of listModels("chatgpt"))
      expect(capabilitySupport(model, "image_generation").supported).toBe(true);
  });

  test("image reading follows the model card's vision declaration", () => {
    expect(capabilitySupport({ provider: "openai", supportsVision: false }, "image_read").supported).toBe(false);
    expect(capabilitySupport({ provider: "openai", supportsVision: true }, "image_read").supported).toBe(true);
  });
});
