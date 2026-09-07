// @summary Tests Gemini image configuration against the same saved auth-store settings as the runtime.

import { describe, expect, test } from "bun:test";
import {
  createResolveGeminiImageConfig,
  DEFAULT_GEMINI_IMAGE_MODEL,
} from "../../../src/tools/image-generation/gemini-config";

describe("Gemini image configuration", () => {
  test("uses the saved Gemini key and configured credential-store mode", async () => {
    const authReads: unknown[] = [];
    const resolve = createResolveGeminiImageConfig({
      env: { GEMINI_API_KEY: "environment-key" },
      loadConfig: async () => ({
        provider: {
          auth: { credentialsStore: "file" },
          gemini: { baseUrl: "https://gemini.example.test/v1beta" },
        },
      }),
      loadAuth: async (options) => {
        authReads.push(options);
        return { gemini: "saved-key" };
      },
    });

    await expect(resolve("/repo")).resolves.toEqual({
      apiKey: "saved-key",
      baseUrl: "https://gemini.example.test/v1beta",
      model: DEFAULT_GEMINI_IMAGE_MODEL,
    });
    expect(authReads).toEqual([{ mode: "file" }]);
  });

  test("falls back to GEMINI_API_KEY and returns undefined when neither source is configured", async () => {
    const base = {
      loadConfig: async () => ({}),
      loadAuth: async () => ({}),
    };

    await expect(
      createResolveGeminiImageConfig({ ...base, env: { GEMINI_API_KEY: "environment-key" } })("/repo"),
    ).resolves.toMatchObject({ apiKey: "environment-key" });
    await expect(createResolveGeminiImageConfig({ ...base, env: {} })("/repo")).resolves.toBeUndefined();
  });
});
