// @summary Exercises shared OAuth refresh and live credentials across image and chat requests.
import { expect, test } from "bun:test";
import { ProviderManager } from "@diligent/core/provider-contract";
import { createChatGPTOAuthBinding } from "../../src/auth/provider-auth";

test("chat and parallel image requests share one refresh and all use the refreshed token", async () => {
  const originalFetch = globalThis.fetch;
  const refreshStarted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const authorizations: string[] = [];
  const persisted: string[] = [];
  let refreshes = 0;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==",
    "base64",
  );
  globalThis.fetch = (async (url, init) => {
    if (String(url).includes("/oauth/token")) {
      refreshes++;
      refreshStarted.resolve();
      await release.promise;
      return Response.json({ access_token: "fresh-access", refresh_token: "fresh-refresh", expires_in: 3600 });
    }
    authorizations.push(new Headers(init?.headers).get("Authorization") ?? "");
    if (String(url).includes("/images/")) return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    return new Response(
      'data: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );
  }) as typeof fetch;
  try {
    const binding = createChatGPTOAuthBinding({
      initialTokens: {
        access_token: "old-access",
        refresh_token: "old-refresh",
        id_token: "header.e30.signature",
        expires_at: 1,
      },
      onTokensRefreshed: async (tokens) => {
        persisted.push(tokens.access_token);
      },
    });
    const manager = new ProviderManager({});
    manager.setExternalAuth("chatgpt", binding.auth);
    const input = { prompt: "Coin", model: "image-test" };
    const images = Promise.all([manager.generateImage("chatgpt", input), manager.generateImage("chatgpt", input)]);
    const stream = manager.createProxyStream()(
      {
        modelId: "chat-test",
        provider: "chatgpt",
        contextWindow: 10000,
        maxOutputTokens: 100,
        supportsThinking: false,
      },
      { systemPrompt: [], tools: [], messages: [] },
      {},
    );
    const chatting = (async () => {
      for await (const _event of stream) {
      }
      return stream.result();
    })();
    await refreshStarted.promise;
    expect(authorizations).toEqual([]);
    release.resolve();
    const [results] = await Promise.all([images, chatting]);
    expect(results.map((result) => result.images[0]?.bytes)).toEqual([png, png]);
    expect(refreshes).toBe(1);
    expect(persisted).toEqual(["fresh-access"]);
    expect(authorizations).toEqual(["Bearer fresh-access", "Bearer fresh-access", "Bearer fresh-access"]);
    binding.clearTokens();
    await expect(manager.generateImage("chatgpt", input)).rejects.toThrow("OAuth");
    expect(authorizations).toHaveLength(3);
  } finally {
    release.resolve();
    globalThis.fetch = originalFetch;
  }
});
