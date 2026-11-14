// @summary Fast mode survives session resume and controls actual OpenAI requests independently of effort
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThreadReadResponse } from "@diligent/protocol";
import {
  createOpenAIStream,
  DiligentAppServer,
  ensureDiligentDir,
  RuntimeAgent,
  resolveModel,
} from "@diligent/runtime";
import { z } from "zod";
import { createProtocolClient } from "./helpers/protocol-client";

const model = resolveModel({ provider: "openai", modelId: "gpt-6.1-sol" });

function completedResponse(): Response {
  return new Response(
    'data: {"type":"response.output_text.delta","delta":"ok"}\n\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
    { headers: { "content-type": "text/event-stream" } },
  );
}

test("Fast mode persists across server restart, stays thread-local, and toggles the wire service tier", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "diligent-fast-mode-"));
  const requests: Record<string, unknown>[] = [];
  const upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      requests.push((await request.json()) as Record<string, unknown>);
      return completedResponse();
    },
  });
  const stream = createOpenAIStream("test-key", `http://127.0.0.1:${upstream.port}/v1`);
  const makeServer = () =>
    new DiligentAppServer({
      cwd,
      resolvePaths: ensureDiligentDir,
      modelConfig: { currentModel: model, getAvailableModels: () => [model], onModelChange: () => {} },
      createAgent: (args) =>
        new RuntimeAgent(resolveModel(args.model), [], [], {
          effort: args.effort,
          fastMode: args.fastMode,
          llmMsgStreamFn: stream,
        }),
    });
  let server = makeServer();
  let client = createProtocolClient(server);
  try {
    const first = await client.initAndStartThread(cwd);
    await client.request("effort/set", { threadId: first, effort: "high" });
    await client.request("fastMode/set", { fastMode: true });
    await client.sendTurnAndWait(first, "fast");
    expect(requests[0]).toMatchObject({
      model: model.modelId,
      service_tier: "priority",
      reasoning: { effort: "high" },
    });

    await server.shutdown();
    client.close();
    server = makeServer();
    client = createProtocolClient(server);
    const second = await client.initAndStartThread(cwd);
    expect(await client.request("thread/read", { threadId: second })).toMatchObject({ currentFastMode: false });
    await client.request("thread/resume", { threadId: first });
    const resumed = (await client.request("thread/read", { threadId: first })) as ThreadReadResponse;
    expect(resumed).toMatchObject({ currentFastMode: true, currentEffort: "high" });
    await client.sendTurnAndWait(first, "still fast");
    expect(requests[1]).toMatchObject({ service_tier: "priority", reasoning: { effort: "high" } });

    await client.request("fastMode/set", { threadId: first, fastMode: false });
    await client.sendTurnAndWait(first, "standard");
    expect(requests[2]).toMatchObject({ model: model.modelId, service_tier: "default", reasoning: { effort: "high" } });
    expect(await client.request("thread/read", { threadId: first })).toMatchObject({ currentFastMode: false });
    const started = (await client.request("thread/start", { cwd, model, fastMode: true })) as { threadId: string };
    await client.sendTurnAndWait(started.threadId, "fast from draft");
    expect(requests[3]).toMatchObject({ service_tier: "priority" });
  } finally {
    await server.shutdown();
    client.close();
    upstream.stop(true);
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a Fast mode change during a tool turn applies only to the next turn", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "diligent-fast-snapshot-"));
  const requests: Record<string, unknown>[] = [];
  const received = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      requests.push((await request.json()) as Record<string, unknown>);
      if (requests.length !== 1) return completedResponse();
      received.resolve();
      await release.promise;
      const item = { id: "item_1", type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" };
      return new Response(
        [
          { type: "response.output_item.added", output_index: 0, item },
          { type: "response.output_item.done", output_index: 0, item },
          {
            type: "response.completed",
            response: { status: "completed", usage: { input_tokens: 1, output_tokens: 1 } },
          },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
        {
          headers: { "content-type": "text/event-stream" },
        },
      );
    },
  });
  const stream = createOpenAIStream("test-key", `http://127.0.0.1:${upstream.port}/v1`);
  const server = new DiligentAppServer({
    cwd,
    resolvePaths: ensureDiligentDir,
    modelConfig: { currentModel: model, getAvailableModels: () => [model], onModelChange: () => {} },
    createAgent: (args) =>
      new RuntimeAgent(
        model,
        [],
        [
          {
            name: "lookup",
            description: "Look up a value",
            parameters: z.object({}),
            execute: async () => ({ output: "value" }),
          },
        ],
        { effort: args.effort, llmMsgStreamFn: stream },
      ),
  });
  const client = createProtocolClient(server);
  try {
    const threadId = await client.initAndStartThread(cwd);
    await client.request("fastMode/set", { threadId, fastMode: true });
    const turn = client.sendTurnAndWait(threadId, "lookup");
    await received.promise;
    await client.request("fastMode/set", { threadId, fastMode: false });
    release.resolve();
    await turn;
    expect(requests.map((request) => request.service_tier)).toEqual(["priority", "priority"]);
    await client.sendTurnAndWait(threadId, "next turn");
    expect(requests[2]?.service_tier).toBe("default");
  } finally {
    release.resolve();
    await server.shutdown();
    client.close();
    upstream.stop(true);
    await rm(cwd, { recursive: true, force: true });
  }
});
