// @summary Tests full Codex image-session deadlines, cancellation, and child-process cleanup.

import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import {
  createCodexAppServerConnector,
  type SpawnCodexAppServer,
} from "../../../src/tools/codex-imagegen/app-server-client";
import { createGenerateCodexImage } from "../../../src/tools/codex-imagegen/generate";

function fakeProcess(options: { stallAt?: string; failAt?: string; ignoreSigterm?: boolean } = {}) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const events = new EventEmitter();
  const methods: string[] = [];
  const signals: Array<NodeJS.Signals | undefined> = [];
  const stalled = Promise.withResolvers<void>();
  let exited = false;
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      const message = JSON.parse(String(chunk)) as { id?: number; method: string };
      methods.push(message.method);
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
  return { spawn, stdin, stdout, stderr, methods, signals, stalled: stalled.promise, exited: () => exited };
}

test.each([
  "initialize",
  "account/read",
  "modelProvider/capabilities/read",
  "thread/start",
  "turn/start",
])("terminates the whole image session when %s never responds", async (stallAt) => {
  const child = fakeProcess({ stallAt });
  const generate = createGenerateCodexImage(createCodexAppServerConnector(child.spawn), { timeoutMs: 25 });

  await expect(generate({ cwd: process.cwd(), prompt: "A blue coin" })).rejects.toThrow("timed out");
  expect(child.methods).toContain(stallAt);
  expect(child.signals).toEqual(["SIGTERM"]);
  expect(child.exited()).toBe(true);
});

test("the same session deadline terminates a turn that never completes", async () => {
  const child = fakeProcess();
  const generate = createGenerateCodexImage(createCodexAppServerConnector(child.spawn), { timeoutMs: 25 });

  await expect(generate({ cwd: process.cwd(), prompt: "A blue coin" })).rejects.toThrow("timed out");
  expect(child.methods).toContain("turn/start");
  expect(child.exited()).toBe(true);
});

test("rejects the active request and reaps Codex when child stdin emits EPIPE", async () => {
  const child = fakeProcess({ failAt: "account/read" });
  const generate = createGenerateCodexImage(createCodexAppServerConnector(child.spawn));

  await expect(generate({ cwd: process.cwd(), prompt: "A blue coin" })).rejects.toThrow("broken pipe");
  expect(child.methods).toContain("account/read");
  expect(child.exited()).toBe(true);
});

test("cancellation interrupts an active request and waits for child exit", async () => {
  const child = fakeProcess({ stallAt: "turn/start" });
  const generate = createGenerateCodexImage(createCodexAppServerConnector(child.spawn));
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
  const connect = createCodexAppServerConnector(child.spawn, { shutdownGraceMs: 10 });

  await expect(connect({ cwd: process.cwd(), timeoutMs: 100, run: async () => "done" })).resolves.toBe("done");
  expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
  expect(child.exited()).toBe(true);
});

test("a failed turn interrupts an unacknowledged turn/start without an unhandled rejection", async () => {
  const child = fakeProcess({ stallAt: "turn/start" });
  const generate = createGenerateCodexImage(createCodexAppServerConnector(child.spawn));
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
