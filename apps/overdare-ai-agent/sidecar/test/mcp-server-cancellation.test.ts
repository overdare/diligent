// @summary Verifies cancellation propagation from MCP and HTTP requests into image providers.

import { expect, test } from "bun:test";
import type { ImageGenerationFn } from "@diligent/core/provider-contract";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { callRegistryTool, createMcpServer, type McpRegistries } from "../src/mcp-server";
import { createRouterEndpoint, ROUTER_TOOL_CALL_ROUTE } from "../src/router-endpoint";
import { createImageGenerationToolProvider } from "../src/tools/image-generation";

async function cancellableImages() {
  const started = Promise.withResolvers<AbortSignal>();
  const stopped = Promise.withResolvers<boolean>();
  const cleanup = new AbortController();
  const generate: ImageGenerationFn = async (_input, { signal } = {}): Promise<never> => {
    if (!signal) throw new Error("Missing provider signal");
    started.resolve(signal);
    return new Promise((_, reject) => {
      const combined = AbortSignal.any([signal, cleanup.signal]);
      combined.addEventListener(
        "abort",
        () => {
          stopped.resolve(signal.aborted);
          reject(combined.reason);
        },
        { once: true },
      );
    });
  };
  const tools = await createImageGenerationToolProvider({
    generateImage: generate,
  }).createTools({ cwd: process.cwd(), modelProvider: "chatgpt" });
  const registries: McpRegistries = {
    tools: new Map(tools.map((tool) => [tool.name, tool])),
    prompts: new Map(),
  };
  return { registries, started: started.promise, stopped: stopped.promise, cleanup };
}

async function stopsPromptly(stopped: Promise<boolean>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      stopped,
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), 200);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("MCP cancellation reaches the ChatGPT-bound tool fixture", async () => {
  const images = await cancellableImages();
  const server = createMcpServer(images.registries);
  const client = new Client({ name: "cancellation-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const controller = new AbortController();
  try {
    const result = client.callTool({ name: "generate_image", arguments: { prompt: "A blue coin" } }, undefined, {
      signal: controller.signal,
    });
    const failure = result.catch((error: unknown) => error);
    const providerSignal = await images.started;
    controller.abort();
    expect(await failure).toBeInstanceOf(Error);
    expect(await stopsPromptly(images.stopped)).toBe(true);
    expect(providerSignal.aborted).toBe(true);
  } finally {
    images.cleanup.abort();
    await client.close();
    await server.close();
  }
});

test("HTTP request cancellation reaches the image provider", async () => {
  const images = await cancellableImages();
  const controller = new AbortController();
  const endpoint = createRouterEndpoint({ token: "test-token", registries: async () => images.registries });
  const url = new URL(`http://127.0.0.1${ROUTER_TOOL_CALL_ROUTE}`);
  const request = new Request(url, {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
    body: JSON.stringify({ tool: "generate_image", args: { prompt: "A blue coin" } }),
    signal: controller.signal,
  });
  const response = endpoint.handle(request, url);
  try {
    await images.started;
    controller.abort(new Error("HTTP request cancelled"));
    expect(await stopsPromptly(images.stopped)).toBe(true);
    expect(await (await response).json()).toMatchObject({ isError: true });
  } finally {
    images.cleanup.abort();
    await response;
  }
});

test("an already cancelled registry call never starts the tool", async () => {
  const images = await cancellableImages();
  const result = await callRegistryTool(
    images.registries,
    "generate_image",
    { prompt: "A blue coin" },
    { signal: AbortSignal.abort(new Error("already cancelled")) },
  );
  expect(result).toMatchObject({ isError: true, content: [{ type: "text", text: "already cancelled" }] });
});
