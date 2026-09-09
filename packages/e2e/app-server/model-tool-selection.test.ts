// @summary Verifies thread-scoped provider tool selection and next-turn model switching through JSON-RPC.

import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultModelRef } from "@diligent/core/model-registry";
import { type BundledToolProvider, ProviderManager, type StreamFunction } from "@diligent/runtime";
import { z } from "zod";
import { createSimpleStream, createToolUseStream } from "./helpers/fake-stream";
import { createProtocolClient, type ProtocolTestClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

const toolName = "provider_bound_tool";
const directories: string[] = [];
const clients: ProtocolTestClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function setup(streamFunction: StreamFunction, execute: () => Promise<string> = async () => "ok") {
  const cwd = await mkdtemp(join(tmpdir(), "provider-tools-"));
  directories.push(cwd);
  const providerManager = new ProviderManager({});
  providerManager.setApiKey("anthropic", "fixture");
  providerManager.setApiKey("gemini", "fixture");
  providerManager.setExternalAuth("chatgpt", { isConfigured: () => true, getStream: () => streamFunction });
  const bundle: BundledToolProvider = {
    id: "@test/provider-tools",
    createTools: ({ modelProvider }) => {
      if (modelProvider !== "chatgpt" && modelProvider !== "gemini") return [];
      return [
        {
          name: toolName,
          description: `Tool for ${modelProvider}`,
          parameters: z.object({}),
          execute: async () => ({ output: await execute() }),
        },
      ];
    },
  };
  const server = createTestServer({
    cwd,
    runtimeToolsConfig: {},
    runtimeConfigOverrides: { providerManager },
    bundledToolProviders: [bundle],
    streamFunction,
  });
  const client = createProtocolClient(server);
  clients.push(client);
  const threadId = await client.initAndStartThread(cwd);
  return { client, threadId, cwd };
}

test("model changes update the tool catalog and model requests for only the selected thread", async () => {
  const calls: Array<{ provider: string; tools: string[] }> = [];
  const simple = createSimpleStream("ok");
  const { client, threadId, cwd } = await setup((model, context, options) => {
    calls.push({
      provider: model.provider,
      tools: (context.tools ?? []).flatMap((tool) => ("name" in tool ? [tool.name] : [])),
    });
    return simple(model, context, options);
  });
  const second = (await client.request("thread/start", {
    cwd,
    model: getDefaultModelRef("gemini"),
  })) as { threadId: string };

  for (const provider of ["anthropic", "gemini", "chatgpt", "anthropic"] as const) {
    await client.request("config/set", { threadId, model: getDefaultModelRef(provider) });
    const listed = (await client.request("tools/list", { threadId })) as { tools: Array<{ name: string }> };
    expect(listed.tools.some((tool) => tool.name === toolName)).toBe(provider !== "anthropic");
    await client.sendTurnAndWait(threadId, "use the current provider");
    expect(calls.at(-1)?.provider).toBe(provider);
    expect(calls.at(-1)?.tools.includes(toolName)).toBe(provider !== "anthropic");

    const other = (await client.request("tools/list", { threadId: second.threadId })) as {
      tools: Array<{ name: string }>;
    };
    expect(other.tools.some((tool) => tool.name === toolName)).toBe(true);
  }
});

test("changing selection during a turn preserves that turn's provider and applies to the next turn", async () => {
  const toolStarted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const providers: string[] = [];
  const visibleTools: string[][] = [];
  const useTool = createToolUseStream([{ id: "bound-call", name: toolName, input: {} }], "done");
  const { client, threadId } = await setup(
    (model, context, options) => {
      providers.push(model.provider);
      visibleTools.push((context.tools ?? []).flatMap((tool) => ("name" in tool ? [tool.name] : [])));
      return useTool(model, context, options);
    },
    async () => {
      toolStarted.resolve();
      await release.promise;
      return "finished";
    },
  );
  await client.request("config/set", { threadId, model: getDefaultModelRef("gemini") });
  const running = client.sendTurnAndWait(threadId, "run the tool");
  try {
    await toolStarted.promise;
    await client.request("config/set", { threadId, model: getDefaultModelRef("anthropic") });
  } finally {
    release.resolve();
  }
  await running;
  expect(providers).toEqual(["gemini", "gemini"]);
  expect(visibleTools.every((tools) => tools.includes(toolName))).toBe(true);
  await client.sendTurnAndWait(threadId, "next turn");
  expect(providers.at(-1)).toBe("anthropic");
  expect(visibleTools.at(-1)).not.toContain(toolName);
});
