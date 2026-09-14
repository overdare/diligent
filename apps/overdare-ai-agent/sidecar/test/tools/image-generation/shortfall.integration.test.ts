// @summary A short image response reaches the next agent turn without failing or generating extra images.
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@diligent/core/agent";
import { EventStream } from "@diligent/core/event-stream";
import type { AssistantMessage } from "@diligent/core/message-contract";
import type { Model, ProviderEvent, ProviderResult, StreamFunction } from "@diligent/core/provider-contract";
import { createImageGenerationToolProvider } from "../../../src/tools/image-generation";

test("n=2 returning one image continues the agent loop with the preserved preview and count", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "image-shortfall-"));
  const bytes = Buffer.from("image fixture");
  let generations = 0;
  let rounds = 0;
  const events: string[] = [];
  const tools = await createImageGenerationToolProvider({
    generateImage: async () => {
      generations++;
      return { images: [{ bytes, mediaType: "image/png" }], requestedModel: "test" };
    },
  }).createTools({ cwd, modelProvider: "chatgpt" });
  const model: Model = {
    provider: "chatgpt",
    modelId: "fixture",
    contextWindow: 100_000,
    maxOutputTokens: 4096,
    supportsThinking: false,
  };
  const streamFunction: StreamFunction = (_, context) => {
    const secondRound = rounds++ > 0;
    if (secondRound) {
      const result = context.messages.find((message) => message.role === "tool_result");
      expect(result).toBeDefined();
      if (!result || result.role !== "tool_result") throw new Error("Expected tool result");
      expect(result.isError).toBe(false);
      expect(JSON.parse(result.output)).toMatchObject({ requestedCount: 2, images: [expect.any(Object)] });
      expect(result.outputImages).toHaveLength(1);
    }
    const message: AssistantMessage = {
      role: "assistant",
      model,
      timestamp: Date.now(),
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      stopReason: secondRound ? "end_turn" : "tool_use",
      content: secondRound
        ? [{ type: "text", text: "Only one image was returned." }]
        : [{ type: "tool_call", id: "image", name: "generate_image", input: { prompt: "A lake", n: 2 } }],
    };
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (event) => event.type === "done",
      (event) => {
        if (event.type !== "done") throw new Error("Expected terminal event");
        return { message: event.message };
      },
    );
    queueMicrotask(() => stream.push({ type: "done", stopReason: message.stopReason, message }));
    return stream;
  };
  const agent = new Agent(model, [], tools, { llmMsgStreamFn: streamFunction });
  agent.subscribe((event) => events.push(event.type));
  try {
    const messages = await agent.prompt({ role: "user", content: "Two lake photos", timestamp: Date.now() });
    const result = messages.find((message) => message.role === "tool_result");
    if (!result || result.role !== "tool_result") throw new Error("Expected saved result");
    expect(await readFile(JSON.parse(result.output).images[0].file)).toEqual(bytes);
    expect(generations).toBe(1);
    expect(rounds).toBe(2);
    expect(events).not.toContain("error");
    expect(events.at(-1)).toBe("agent_end");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
