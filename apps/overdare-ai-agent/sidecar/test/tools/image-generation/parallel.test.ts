// @summary Exercises the real agent scheduler with independent image requests and isolated outputs.
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@diligent/core/agent";
import { EventStream } from "@diligent/core/event-stream";
import type { AssistantMessage } from "@diligent/core/message-contract";
import type { Model, ProviderEvent, ProviderResult, StreamFunction } from "@diligent/core/provider-contract";
import { createImageGenerationToolProvider } from "../../../src/tools/image-generation";

test("three image calls share the same reference, overlap, and save distinct files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "parallel-images-"));
  const reference = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGPkEpH7z8XFxQAABvcBW4Wvy/wAAAAASUVORK5CYII=",
    "base64",
  );
  await writeFile(join(cwd, "reference.png"), reference);
  const bothStarted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let started = 0;
  const tools = await createImageGenerationToolProvider({
    generateImage: async (input) => {
      expect(input.referenceImages).toEqual([{ bytes: reference, mediaType: "image/png" }]);
      expect(input).not.toHaveProperty("n");
      if (++started === 3) bothStarted.resolve();
      await release.promise;
      return { images: [{ bytes: Buffer.from("fixture image"), mediaType: "image/png" }], requestedModel: input.model };
    },
  }).createTools({ cwd, modelProvider: "chatgpt" });
  const model: Model = {
    provider: "chatgpt",
    modelId: "fixture",
    contextWindow: 100_000,
    maxOutputTokens: 4096,
    supportsThinking: false,
  };
  let round = 0;
  const streamFunction: StreamFunction = () => {
    const message: AssistantMessage = {
      role: "assistant",
      model,
      timestamp: Date.now(),
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      stopReason: round++ === 0 ? "tool_use" : "end_turn",
      content:
        round === 1
          ? ["attack", "jump", "defend"].map((name) => ({
              type: "tool_call",
              id: name,
              name: "generate_image",
              input: { prompt: name, referenceImages: ["reference.png"] },
            }))
          : [{ type: "text", text: "done" }],
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
  const running = agent.prompt({ role: "user", content: "Generate three independent icons", timestamp: Date.now() });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const overlapped = await Promise.race([
      bothStarted.promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 1000);
      }),
    ]);
    expect(overlapped).toBe(true);
  } finally {
    clearTimeout(timer);
    release.resolve();
    await running;
    try {
      const results = agent.getMessages().filter((message) => message.role === "tool_result");
      expect(results).toHaveLength(3);
      const files = results.map((result) => JSON.parse(result.output).images[0].file);
      expect(new Set(files).size).toBe(3);
      for (const file of files) expect(await readFile(file, "utf8")).toBe("fixture image");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
});
