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

for (const modelId of ["gemini-3.5-flash-lite", "gemini-flash-lite"]) {
  test(`prices ${modelId} cached input at the documented Standard paid rate`, () => {
    const model = resolveModel({ provider: "gemini", modelId });

    expect(
      calculateUsageCost(model, {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 80_000,
        cacheWriteTokens: 0,
      }),
    ).toBeCloseTo(0.0024, 10);
    expect(
      calculateUsageCost(model, {
        inputTokens: 20_000,
        outputTokens: 10_000,
        cacheReadTokens: 80_000,
        cacheWriteTokens: 0,
      }),
    ).toBeCloseTo(0.0334, 10);
  });
}

for (const modelId of ["claude-sonnet-5", "claude-sonnet", "sonnet", "sonnet-5"]) {
  test(`prices ${modelId} token classes at the documented Sonnet 5 Standard rates`, () => {
    const model = resolveModel({ provider: "anthropic", modelId });
    const emptyUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

    expect(calculateUsageCost(model, { ...emptyUsage, inputTokens: 10_000 })).toBeCloseTo(0.02, 10);
    expect(calculateUsageCost(model, { ...emptyUsage, outputTokens: 10_000 })).toBeCloseTo(0.1, 10);
    expect(calculateUsageCost(model, { ...emptyUsage, cacheReadTokens: 10_000 })).toBeCloseTo(0.002, 10);
    expect(calculateUsageCost(model, { ...emptyUsage, cacheWriteTokens: 10_000 })).toBeCloseTo(0.025, 10);
    expect(
      calculateUsageCost(model, {
        inputTokens: 10_000,
        outputTokens: 10_000,
        cacheReadTokens: 10_000,
        cacheWriteTokens: 10_000,
      }),
    ).toBeCloseTo(0.147, 10);
  });
}
