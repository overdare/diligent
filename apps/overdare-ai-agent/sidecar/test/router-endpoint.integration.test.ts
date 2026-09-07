// @summary Checks that a disconnected HTTP client cancels the actual sidecar tool execution.

import { expect, test } from "bun:test";
import { z } from "zod";
import { createRouterEndpoint, ROUTER_TOOL_CALL_ROUTE } from "../src/router-endpoint";

test("closing an in-flight HTTP request aborts the tool", async () => {
  const started = Promise.withResolvers<void>();
  const stopped = Promise.withResolvers<boolean>();
  const cleanup = new AbortController();
  const endpoint = createRouterEndpoint({
    token: "test-token",
    registries: async () => ({
      prompts: new Map(),
      tools: new Map([
        [
          "pending",
          {
            name: "pending",
            description: "Wait until the request is cancelled",
            parameters: z.object({}),
            async execute(_args, ctx) {
              started.resolve();
              const signal = AbortSignal.any([ctx.signal, cleanup.signal]);
              await new Promise<void>((resolve) => {
                signal.addEventListener(
                  "abort",
                  () => {
                    stopped.resolve(ctx.signal.aborted);
                    resolve();
                  },
                  { once: true },
                );
              });
              return { output: "stopped" };
            },
          },
        ],
      ]),
    }),
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => endpoint.handle(request, new URL(request.url)),
  });
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = fetch(new URL(ROUTER_TOOL_CALL_ROUTE, server.url), {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: JSON.stringify({ tool: "pending" }),
      signal: controller.signal,
    }).catch((error: unknown) => error);
    await started.promise;
    controller.abort();
    expect(await response).toBeInstanceOf(Error);
    const cancelled = await Promise.race([
      stopped.promise,
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), 1_000);
      }),
    ]);
    expect(cancelled).toBe(true);
  } finally {
    clearTimeout(timer);
    cleanup.abort();
    await server.stop(true);
  }
});
