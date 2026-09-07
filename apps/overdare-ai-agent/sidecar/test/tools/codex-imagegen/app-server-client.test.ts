// @summary Tests full Codex image-session deadlines, cancellation, and child-process cleanup.

import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { createCodexAppServer } from "../../../src/tools/codex-imagegen/app-server-client";
import { createGenerateCodexImage } from "../../../src/tools/codex-imagegen/generate";
import type { SpawnCodexAppServer } from "../../../src/tools/codex-imagegen/process";

function fakeProcess(options: { stallAt?: string; failAt?: string; ignoreSigterm?: boolean } = {}) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const events = new EventEmitter();
  const methods: string[] = [];
  const requests: Array<{ id?: number; method: string; params?: Record<string, unknown> }> = [];
  const signals: Array<NodeJS.Signals | undefined> = [];
  const stalled = Promise.withResolvers<void>();
  let exited = false;
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      const message = JSON.parse(String(chunk)) as { id?: number; method: string };
      methods.push(message.method);
      requests.push(message);
      if (message.method === options.stallAt) stalled.resolve();
      else if (message.method === options.failAt) {
        queueMicrotask(() => stdin.emit("error", new Error("broken pipe")));
      } else if (message.id !== undefined) {
        const result =
          message.method === "account/read"
            ? { account: { type: "chatgpt" } }
            : message.method === "modelProvider/capabilities/read"
              ? { imageGeneration: true }
              : message.method === "thread/start"
                ? { thread: { id: "thread-1" } }
                : {};
        queueMicrotask(() => stdout.write(`${JSON.stringify({ id: message.id, result })}\n`));
      }
      callback();
    },
  });
  const spawn: SpawnCodexAppServer = () =>
    Object.assign(events, {
      stdin,
      stdout,
      stderr,
      kill: (signal?: NodeJS.Signals) => {
        signals.push(signal);
        if (signal !== "SIGTERM" || !options.ignoreSigterm) {
          queueMicrotask(() => {
            exited = true;
            events.emit("exit", null);
          });
        }
        return true;
      },
    });
  return {
    spawn,
    stdin,
    stdout,
    stderr,
    events,
    methods,
    requests,
    signals,
    stalled: stalled.promise,
    exited: () => exited,
  };
}

test("keeps image events before turn/start acknowledgement and filters other threads", async () => {
  const child = fakeProcess({ stallAt: "turn/start" });
  const generate = createGenerateCodexImage((options) => createCodexAppServer({ ...options, spawn: child.spawn }));
  const imagePath = `${process.cwd()}/generated.png`;
  const result = generate({ cwd: process.cwd(), prompt: "A blue coin" });
  await child.stalled;
  for (const message of [
    { method: "turn/completed", params: { threadId: "unrelated", turn: { status: "failed" } } },
    {
      method: "item/completed",
      params: {
        threadId: "thread-1",
        item: { type: "imageGeneration", savedPath: imagePath, revisedPrompt: "refined" },
      },
    },
    { method: "turn/completed", params: { threadId: "thread-1", turn: { status: "completed" } } },
    {
      method: "item/completed",
      params: { threadId: "thread-1", item: { type: "imageGeneration", savedPath: `${imagePath}.late.png` } },
    },
    { id: child.requests.at(-1)!.id, result: { turn: { id: "turn-1" } } },
  ]) {
    child.stdout.write(`${JSON.stringify(message)}\n`);
  }

  await expect(result).resolves.toEqual({ sourcePath: imagePath, revisedPrompt: "refined" });
  expect(child.requests.find((request) => request.method === "thread/start")?.params).toMatchObject({
    cwd: process.cwd(),
    ephemeral: true,
  });
  expect(child.requests.find((request) => request.method === "turn/start")?.params).toMatchObject({
    threadId: "thread-1",
    cwd: process.cwd(),
    input: [{ type: "text", text: "$imagegen\nA blue coin" }],
  });
  expect(child.exited()).toBe(true);
});

test("closes a child that ends stdout without exiting", async () => {
  const child = fakeProcess({ stallAt: "initialize" });
  const generate = createGenerateCodexImage((options) => createCodexAppServer({ ...options, spawn: child.spawn }), {
    timeoutMs: 100,
  });
  const failure = generate({ cwd: process.cwd(), prompt: "A blue coin" }).catch((error: unknown) => error);
  await child.stalled;
  child.stdout.end();

  expect(String(await failure)).toContain("output closed");
  expect(child.exited()).toBe(true);
});

test("a failed spawn without an exit event still closes the session", async () => {
  const child = fakeProcess({ stallAt: "initialize" });
  const generate = createGenerateCodexImage((options) => createCodexAppServer({ ...options, spawn: child.spawn }));
  const failure = generate({ cwd: process.cwd(), prompt: "A blue coin" }).catch((error: unknown) => error);
  await child.stalled;
  child.events.emit("error", new Error("spawn codex ENOENT"));

  expect(String(await failure)).toContain("spawn codex ENOENT");
  expect(child.signals).toEqual([]);
  expect(child.stdout.destroyed).toBe(true);
});

test.each([
  "initialize",
  "account/read",
  "modelProvider/capabilities/read",
  "thread/start",
  "turn/start",
])("terminates the whole image session when %s never responds", async (stallAt) => {
  const child = fakeProcess({ stallAt });
  const generate = createGenerateCodexImage((options) => createCodexAppServer({ ...options, spawn: child.spawn }), {
    timeoutMs: 25,
  });

  await expect(generate({ cwd: process.cwd(), prompt: "A blue coin" })).rejects.toThrow("timed out");
  expect(child.methods).toContain(stallAt);
  expect(child.signals).toEqual(["SIGTERM"]);
  expect(child.exited()).toBe(true);
});

test("the same session deadline terminates a turn that never completes", async () => {
  const child = fakeProcess();
  const generate = createGenerateCodexImage((options) => createCodexAppServer({ ...options, spawn: child.spawn }), {
    timeoutMs: 25,
  });

  await expect(generate({ cwd: process.cwd(), prompt: "A blue coin" })).rejects.toThrow("timed out");
  expect(child.methods).toContain("turn/start");
  expect(child.exited()).toBe(true);
});

test("rejects the active request and reaps Codex when child stdin emits EPIPE", async () => {
  const child = fakeProcess({ failAt: "account/read" });
  const generate = createGenerateCodexImage((options) => createCodexAppServer({ ...options, spawn: child.spawn }));

  await expect(generate({ cwd: process.cwd(), prompt: "A blue coin" })).rejects.toThrow("broken pipe");
  expect(child.methods).toContain("account/read");
  expect(child.exited()).toBe(true);
});

test("cancellation interrupts an active request and waits for child exit", async () => {
  const child = fakeProcess({ stallAt: "turn/start" });
  const generate = createGenerateCodexImage((options) => createCodexAppServer({ ...options, spawn: child.spawn }));
  const controller = new AbortController();
  const result = generate({ cwd: process.cwd(), prompt: "A blue coin", signal: controller.signal });
  const failure = result.catch((error: unknown) => error);
  await child.stalled;
  controller.abort(new Error("cancelled by client"));

  expect(await failure).toBeInstanceOf(Error);
  expect(String(await failure)).toContain("cancelled by client");
  expect(child.exited()).toBe(true);
  expect(child.stdin.destroyed).toBe(true);
  expect(child.stdout.destroyed).toBe(true);
  expect(child.stderr.destroyed).toBe(true);
});

test("forces termination if Codex ignores graceful shutdown", async () => {
  const child = fakeProcess({ ignoreSigterm: true });
  const client = createCodexAppServer({
    cwd: process.cwd(),
    timeoutMs: 100,
    spawn: child.spawn,
    shutdownGraceMs: 10,
  });

  await client.initialize();
  await client.close();
  expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
  expect(child.exited()).toBe(true);
});

test("a failed turn interrupts an unacknowledged turn/start without an unhandled rejection", async () => {
  const child = fakeProcess({ stallAt: "turn/start" });
  const generate = createGenerateCodexImage((options) => createCodexAppServer({ ...options, spawn: child.spawn }));
  const result = generate({ cwd: process.cwd(), prompt: "A blue coin" });
  const failure = result.catch((error: unknown) => error);
  await child.stalled;
  child.stdout.write(
    `${JSON.stringify({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { status: "failed", error: { message: "quota exhausted" } } },
    })}\n`,
  );

  expect(await failure).toBeInstanceOf(Error);
  expect(String(await failure)).toContain("quota exhausted");
  expect(child.exited()).toBe(true);
});
