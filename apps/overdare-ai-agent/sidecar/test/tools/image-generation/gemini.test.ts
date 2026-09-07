// @summary Tests the Gemini native image-model adapter without making network requests.

import { describe, expect, test } from "bun:test";
import { createGenerateGeminiImage, type GeminiImageFetch } from "../../../src/tools/image-generation/gemini";

describe("Gemini image generation", () => {
  test("uses the configured key and image model and returns the generated image bytes", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImage: GeminiImageFetch = async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          status: "completed",
          steps: [
            {
              type: "model_output",
              content: [
                {
                  type: "image",
                  data: Buffer.from("gemini-image").toString("base64"),
                  mime_type: "image/png",
                },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    };
    const generate = createGenerateGeminiImage(fetchImage);
    const signal = new AbortController().signal;

    await expect(
      generate({ apiKey: "secret", model: "gemini-image-model", prompt: "A blue coin", signal }),
    ).resolves.toEqual({
      bytes: Buffer.from("gemini-image"),
      mediaType: "image/png",
      model: "gemini-image-model",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(calls[0]?.init?.headers).toEqual({
      "Content-Type": "application/json",
      "x-goog-api-key": "secret",
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      model: "gemini-image-model",
      input: [{ type: "text", text: "A blue coin" }],
      response_format: { type: "image" },
    });
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("fails clearly when Gemini completes without an image", async () => {
    const fetchImage: GeminiImageFetch = async () =>
      new Response(JSON.stringify({ status: "completed", steps: [] }), { status: 200 });
    const generate = createGenerateGeminiImage(fetchImage);

    await expect(generate({ apiKey: "secret", model: "gemini-image-model", prompt: "A blue coin" })).rejects.toThrow(
      "without an image",
    );
  });

  test("surfaces Gemini API errors without leaking the configured key", async () => {
    const fetchImage: GeminiImageFetch = async () =>
      new Response(JSON.stringify({ error: { message: "model is unavailable" } }), { status: 404 });
    const generate = createGenerateGeminiImage(fetchImage);

    const failure = generate({ apiKey: "super-secret", model: "missing-model", prompt: "A blue coin" });
    await expect(failure).rejects.toThrow("model is unavailable");
    await expect(failure).rejects.not.toThrow("super-secret");
  });
});
