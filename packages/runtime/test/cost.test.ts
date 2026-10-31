// @summary Tests for usage cost calculation across uncached, cache-read, and cache-write tokens

import { expect, test } from "bun:test";
import { resolveModel } from "@diligent/core/model-registry";
import type { Model } from "@diligent/core/provider-contract";
import { calculateUsageCost } from "../src/cost";

test("prices cache writes separately from input, output, and cache reads", () => {
  const model: Model = {
    modelId: "synthetic-cost-model",
    provider: "openai",
    contextWindow: 1_000_000,
    maxOutputTokens: 100_000,
    supportsThinking: false,
    inputCostPer1M: 2,
    outputCostPer1M: 3,
    cacheReadCostPer1M: 0.5,
    cacheWriteCostPer1M: 4,
  };
  const cost = calculateUsageCost(model, {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 1_000_000,
  });

  expect(cost).toBe(9.5);
});

test("prices Astra 30-minute cache writes at the OpenAI Standard short-context rate, including aliases", () => {
  // Regression: Astra previously made reported cache writes free. The official rate is
  // $12.50/MTok for <=272K input tokens, not an additional fee on uncached input.
  for (const modelId of ["gpt-6-astra", "gpt-6", "astra"]) {
    const model = resolveModel({ provider: "openai", modelId });
    expect(
      calculateUsageCost(model, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 10_000,
      }),
    ).toBeCloseTo(0.125, 10);
    expect(
      calculateUsageCost(model, {
        inputTokens: 1_000,
        outputTokens: 1_000,
        cacheReadTokens: 1_000,
        cacheWriteTokens: 10_000,
      }),
    ).toBeCloseTo(0.186, 10);
  }
});
