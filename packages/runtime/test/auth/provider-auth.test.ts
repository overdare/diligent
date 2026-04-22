// @summary Regression tests for runtime provider-auth bindings
import { describe, expect, it, mock } from "bun:test";
import { createVertexAccessTokenBinding } from "../../src/auth/provider-auth";

describe("createVertexAccessTokenBinding", () => {
  it("refreshes ADC token before first stream request", async () => {
    const spawnMock = mock(() => {
      const stdout = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("ya29.fresh-token\n"));
          controller.close();
        },
      });
      const stderr = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      return {
        stdout,
        stderr,
        exited: Promise.resolve(0),
      } as unknown as ReturnType<typeof Bun.spawn>;
    });

    const originalSpawn = Bun.spawn;
    Bun.spawn = spawnMock as typeof Bun.spawn;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      ),
    ) as typeof fetch;

    try {
      const binding = createVertexAccessTokenBinding({
        project: "demo-project",
        location: "us-central1",
        endpoint: "openapi",
        authMode: "adc",
      });

      const stream = binding.auth.getStream()(
        {
          id: "vertex-gemma-4-26b-it",
          provider: "vertex",
          contextWindow: 256_000,
          maxOutputTokens: 8_192,
          supportsThinking: false,
        },
        { systemPrompt: [], messages: [], tools: [] },
        {},
      );

      const events = [] as string[];
      for await (const event of stream) {
        events.push(event.type);
      }
      await stream.result();

      expect(spawnMock).toHaveBeenCalledTimes(1);
      expect(binding.getToken()).toBe("ya29.fresh-token");
      expect(events).toContain("start");
      expect(events).toContain("done");
    } finally {
      Bun.spawn = originalSpawn;
      globalThis.fetch = originalFetch;
    }
  });

  it("uses the global Vertex host when location is global", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(
          'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
          {
            status: 200,
            headers: { "content-type": "text/event-stream" },
          },
        ),
      ),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    try {
      const binding = createVertexAccessTokenBinding({
        project: "demo-project",
        location: "global",
        endpoint: "openapi",
        authMode: "access_token",
        accessToken: "ya29.test-token",
      });

      const stream = binding.auth.getStream()(
        {
          id: "vertex-gemma-4-26b-it",
          provider: "vertex",
          contextWindow: 256_000,
          maxOutputTokens: 8_192,
          supportsThinking: false,
        },
        { systemPrompt: [], messages: [], tools: [] },
        {},
      );

      for await (const _event of stream) {
      }
      await stream.result();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0] ?? [];
      expect(String(url)).toContain(
        "https://aiplatform.googleapis.com/v1/projects/demo-project/locations/global/endpoints/openapi/chat/completions",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
