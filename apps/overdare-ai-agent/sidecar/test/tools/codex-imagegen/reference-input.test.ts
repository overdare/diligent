// @summary Verifies that visual references reach Codex as localImage input blocks, not prompt text.
import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { createCodexAppServer } from "../../../src/tools/codex-imagegen/app-server-client";
import { createGenerateCodexImage } from "../../../src/tools/codex-imagegen/generate";
import type { SpawnCodexAppServer } from "../../../src/tools/codex-imagegen/process";

test("passes ordered reference attachments through the generation session onto the Codex wire", async () => {
  const stdout = new PassThrough();
  const events = new EventEmitter();
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const write = (message: unknown) => stdout.write(`${JSON.stringify(message)}\n`);
  let closed = false;
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      const request = JSON.parse(String(chunk));
      requests.push(request);
      if (request.id !== undefined) {
        const result =
          request.method === "account/read"
            ? { account: { type: "chatgpt" } }
            : request.method === "modelProvider/capabilities/read"
              ? { imageGeneration: true }
              : request.method === "thread/start"
                ? { thread: { id: "thread" } }
                : {};
        queueMicrotask(() => {
          write({ id: request.id, result });
          if (request.method === "turn/start") {
            write({
              method: "item/completed",
              params: {
                threadId: "thread",
                item: { type: "imageGeneration", savedPath: `${process.cwd()}/result.png` },
              },
            });
            write({ method: "turn/completed", params: { threadId: "thread", turn: { status: "completed" } } });
          }
        });
      }
      callback();
    },
  });
  const spawn: SpawnCodexAppServer = () =>
    Object.assign(events, {
      stdin,
      stdout,
      stderr: new PassThrough(),
      kill() {
        closed = true;
        queueMicrotask(() => events.emit("exit", 0));
        return true;
      },
    });
  const generate = createGenerateCodexImage((options) => createCodexAppServer({ ...options, spawn }));
  const referenceImages = [`${process.cwd()}/mobile mockup.png`, `${process.cwd()}/anchor.webp`];
  const result = await generate({
    cwd: process.cwd(),
    prompt: "Keep the frame; change only the glyph",
    referenceImages,
  });

  expect(requests.find((request) => request.method === "turn/start")?.params.input).toEqual([
    { type: "text", text: "$imagegen\nKeep the frame; change only the glyph" },
    ...referenceImages.map((path) => ({ type: "localImage", path })),
  ]);
  expect(result.sourcePath).toBe(`${process.cwd()}/result.png`);
  expect(closed).toBe(true);
});
