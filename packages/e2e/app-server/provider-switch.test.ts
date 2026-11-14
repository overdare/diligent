// @summary Provider changes preserve the active turn and apply to model and tools on the next turn.
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultModelRef, resolveModel } from "@diligent/core/model-registry";
import type { ProviderEvent, ProviderResult, StreamFunction } from "@diligent/core/provider-contract";
import type { ThreadReadResponse } from "@diligent/protocol";
import { EventStream, ProviderManager } from "@diligent/runtime";
import { z } from "zod";
import { createProtocolClient } from "./helpers/protocol-client";
import { createTestServer } from "./helpers/server-factory";

test.each([
  { from: "anthropic", to: "chatgpt" },
  { from: "chatgpt", to: "anthropic" },
] as const)("config/set from $from to $to applies after the active turn", async ({ from, to }) => {
  const cwd = await mkdtemp(join(tmpdir(), "diligent-provider-switch-"));
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let calls = 0;
  const streamFunction: StreamFunction = (model, context) => {
    const iteration = calls++;
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (event) => event.type === "done",
      (event) => ({ message: (event as Extract<ProviderEvent, { type: "done" }>).message }),
    );
    void (async () => {
      stream.push({ type: "start" });
      if (iteration === 0) {
        started.resolve();
        await release.promise;
      }
      const toolUse = iteration % 2 === 0;
      const text = JSON.stringify({
        provider: model.provider,
        tool: context.tools.filter((tool) => "name" in tool).find((tool) => tool.name === "provider_probe")
          ?.description,
      });
      stream.push({
        type: "done",
        stopReason: toolUse ? "tool_use" : "end_turn",
        message: {
          role: "assistant",
          content: toolUse
            ? [{ type: "tool_call", id: `probe-${iteration}`, name: "provider_probe", input: {} }]
            : [{ type: "text", text }],
          model: { provider: model.provider, modelId: model.modelId },
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
          stopReason: toolUse ? "tool_use" : "end_turn",
          timestamp: Date.now(),
        },
      });
    })().catch((error) => stream.error(error));
    return stream;
  };
  const providerManager = new ProviderManager({
    auth: {
      [from]: { isConfigured: () => true, getStream: () => streamFunction },
      [to]: { isConfigured: () => true, getStream: () => streamFunction },
    },
  });
  const server = createTestServer({
    cwd,
    streamFunction,
    runtimeToolsConfig: {},
    runtimeConfigOverrides: { model: resolveModel(getDefaultModelRef(from)), providerManager },
    bundledToolProviders: [
      {
        id: "test-provider-probe",
        createTools: ({ modelProvider }) => [
          {
            name: "provider_probe",
            description: `Tool for ${modelProvider}`,
            parameters: z.object({}),
            execute: async () => ({ output: modelProvider! }),
          },
        ],
      },
    ],
  });
  const client = createProtocolClient(server);
  let activeTurn: Promise<unknown> | undefined;
  try {
    const threadId = await client.initAndStartThread(cwd);
    activeTurn = client.sendTurnAndWait(threadId, "Run the provider probe");
    await started.promise;
    await client.request("config/set", { threadId, model: getDefaultModelRef(to) });
    release.resolve();
    await activeTurn;
    await client.sendTurnAndWait(threadId, "Run it again with the selected provider");

    const history = (await client.request("thread/read", { threadId })) as ThreadReadResponse;
    expect(history.currentModel).toEqual(getDefaultModelRef(to));
    expect(
      history.items
        .filter((item) => item.type === "toolCall")
        .filter((item) => item.output !== undefined)
        .map((item) => ({ output: item.output, error: item.isError })),
    ).toEqual([
      { output: from, error: false },
      { output: to, error: false },
    ]);
    const text = history.items
      .filter((item) => item.type === "agentMessage")
      .flatMap((item) => item.message.content.filter((block) => block.type === "text").map((block) => block.text));
    expect(text).toEqual([
      JSON.stringify({ provider: from, tool: `Tool for ${from}` }),
      JSON.stringify({ provider: to, tool: `Tool for ${to}` }),
    ]);
  } finally {
    release.resolve();
    await activeTurn?.catch(() => {});
    client.close();
    await rm(cwd, { recursive: true, force: true });
  }
});
