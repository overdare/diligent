// @summary Tests the image workflow independently of Codex wire messages and child processes.

import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CodexAppServerSession,
  CodexImageEvent,
  CreateCodexAppServer,
} from "../../../src/tools/codex-imagegen/app-server-client";
import { createGenerateCodexImage } from "../../../src/tools/codex-imagegen/generate";

const GENERATED_PATH = join(tmpdir(), "codex-image.png");

function fakeCodex(
  options: { accountType?: string; imageGeneration?: boolean; events?: CodexImageEvent[]; streamError?: Error } = {},
) {
  const calls: string[] = [];
  let closed = false;
  const client: CodexAppServerSession = {
    async initialize() {
      calls.push("initialize");
    },
    async readAccount() {
      calls.push("readAccount");
      return { type: options.accountType ?? "chatgpt" };
    },
    async readCapabilities() {
      calls.push("readCapabilities");
      return { imageGeneration: options.imageGeneration ?? true };
    },
    async startThread(cwd) {
      calls.push("startThread");
      expect(cwd).toBe("/repo");
      return "thread-1";
    },
    async *runTurn(input) {
      calls.push("runTurn");
      expect(input).toEqual({ threadId: "thread-1", cwd: "/repo", prompt: "A blue coin" });
      yield* options.events ?? [
        { type: "image", savedPath: GENERATED_PATH, revisedPrompt: "refined" },
        { type: "completed", status: "completed" },
      ];
      if (options.streamError) throw options.streamError;
    },
    async close() {
      closed = true;
    },
  };
  const createClient: CreateCodexAppServer = () => client;
  return { createClient, calls, closed: () => closed };
}

describe("Codex image generation workflow", () => {
  test("does not accept an image without a completed turn", async () => {
    const fake = fakeCodex({ events: [{ type: "image", savedPath: GENERATED_PATH }] });
    const generate = createGenerateCodexImage(fake.createClient);

    await expect(generate({ cwd: "/repo", prompt: "A blue coin" })).rejects.toThrow("without completing");
    expect(fake.closed()).toBe(true);
  });

  test("waits for the event stream to finish even after receiving a completed image", async () => {
    const fake = fakeCodex({ streamError: new Error("turn/start acknowledgement failed") });
    const generate = createGenerateCodexImage(fake.createClient);

    await expect(generate({ cwd: "/repo", prompt: "A blue coin" })).rejects.toThrow("acknowledgement failed");
    expect(fake.closed()).toBe(true);
  });

  test("checks authentication and capability before generating, then closes the client", async () => {
    const fake = fakeCodex();
    const generate = createGenerateCodexImage(fake.createClient);

    await expect(generate({ cwd: "/repo", prompt: "A blue coin" })).resolves.toEqual({
      sourcePath: GENERATED_PATH,
      revisedPrompt: "refined",
    });
    expect(fake.calls).toEqual(["initialize", "readAccount", "readCapabilities", "startThread", "runTurn"]);
    expect(fake.closed()).toBe(true);
  });

  test("closes the client after rejecting non-managed authentication", async () => {
    const fake = fakeCodex({ accountType: "apiKey" });
    const generate = createGenerateCodexImage(fake.createClient);

    await expect(generate({ cwd: "/repo", prompt: "A blue coin" })).rejects.toThrow("managed ChatGPT OAuth");
    expect(fake.calls).toEqual(["initialize", "readAccount"]);
    expect(fake.closed()).toBe(true);
  });

  test("closes the client after rejecting an account without image generation", async () => {
    const fake = fakeCodex({ imageGeneration: false });
    const generate = createGenerateCodexImage(fake.createClient);

    await expect(generate({ cwd: "/repo", prompt: "A blue coin" })).rejects.toThrow(
      "does not support image generation",
    );
    expect(fake.calls).toEqual(["initialize", "readAccount", "readCapabilities"]);
    expect(fake.closed()).toBe(true);
  });

  test("does not return an image when the turn fails after producing it", async () => {
    const fake = fakeCodex({
      events: [
        { type: "image", savedPath: GENERATED_PATH },
        { type: "completed", status: "failed", error: "quota exhausted" },
      ],
    });
    const generate = createGenerateCodexImage(fake.createClient);

    await expect(generate({ cwd: "/repo", prompt: "A blue coin" })).rejects.toThrow("quota exhausted");
    expect(fake.closed()).toBe(true);
  });

  test("rejects a completed turn without a usable absolute image path", async () => {
    const fake = fakeCodex({
      events: [
        { type: "image", savedPath: "relative.png" },
        { type: "completed", status: "completed" },
      ],
    });
    const generate = createGenerateCodexImage(fake.createClient);

    await expect(generate({ cwd: "/repo", prompt: "A blue coin" })).rejects.toThrow("without producing a saved image");
    expect(fake.closed()).toBe(true);
  });
});
