// @summary Tests Gemini image configuration against the same saved auth-store settings as the runtime.

import { describe, expect, test } from "bun:test";
import {
  createResolveGeminiImageConfig,
  DEFAULT_GEMINI_IMAGE_MODEL,
} from "../../../src/tools/image-generation/gemini-config";

describe("Gemini image configuration", () => {
  test("does not reactivate a disconnected provider from a legacy config key", async () => {
    const resolve = createResolveGeminiImageConfig({
      loadConfig: async () => ({ provider: { gemini: { apiKey: "legacy-key" } } }),
      loadAuth: async () => ({}),
    });

    await expect(resolve("/repo")).resolves.toBeUndefined();
  });

  test("uses the saved Gemini key and configured credential-store mode", async () => {
    const authReads: unknown[] = [];
    const resolve = createResolveGeminiImageConfig({
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

  test("observes removal of the saved key on the next call", async () => {
    let keys: { gemini?: string } = { gemini: "saved-key" };
    const resolve = createResolveGeminiImageConfig({
      loadConfig: async () => ({}),
      loadAuth: async () => keys,
    });

    await expect(resolve("/repo")).resolves.toMatchObject({ apiKey: "saved-key" });
    keys = {};
    await expect(resolve("/repo")).resolves.toBeUndefined();
  });
});
