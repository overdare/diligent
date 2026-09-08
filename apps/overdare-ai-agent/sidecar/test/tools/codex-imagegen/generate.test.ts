// @summary Tests the image workflow independently of Codex wire messages and child processes.

import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodexAppServerSession, CreateCodexAppServer } from "../../../src/tools/codex-imagegen/app-server-client";
import { createGenerateCodexImage } from "../../../src/tools/codex-imagegen/generate";
import type { CodexImageItem } from "../../../src/tools/codex-imagegen/protocol";

const GENERATED_PATH = join(tmpdir(), "codex-image.png");

function fakeCodex(
  options: { accountType?: string; imageGeneration?: boolean; images?: CodexImageItem[]; turnError?: Error } = {},
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
    async runTurn(input) {
      calls.push("runTurn");
      expect(input).toEqual({ threadId: "thread-1", cwd: "/repo", prompt: "A blue coin" });
      if (options.turnError) throw options.turnError;
      return options.images ?? [{ savedPath: GENERATED_PATH, revisedPrompt: "refined" }];
    },
    async close() {
      closed = true;
    },
  };
  const createClient: CreateCodexAppServer = () => client;
  return { createClient, calls, closed: () => closed };
}

describe("Codex image generation workflow", () => {
  test("closes the client when the turn does not complete successfully", async () => {
    const fake = fakeCodex({ turnError: new Error("turn interrupted") });
    const generate = createGenerateCodexImage(fake.createClient);

    await expect(generate({ cwd: "/repo", prompt: "A blue coin" })).rejects.toThrow("turn interrupted");
    expect(fake.closed()).toBe(true);
  });

  test("selects the last usable image and trims its revised prompt", async () => {
    const fake = fakeCodex({
      images: [
        { savedPath: join(tmpdir(), "earlier.png"), revisedPrompt: "old" },
        { savedPath: GENERATED_PATH, revisedPrompt: "  refined  " },
        { savedPath: "relative.png" },
        {},
      ],
    });
    const generate = createGenerateCodexImage(fake.createClient);

    await expect(generate({ cwd: "/repo", prompt: "A blue coin" })).resolves.toEqual({
      sourcePath: GENERATED_PATH,
      revisedPrompt: "refined",
    });
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

  test.each([null, "  "])("omits an empty revised prompt (%s)", async (revisedPrompt) => {
    const fake = fakeCodex({ images: [{ savedPath: GENERATED_PATH, revisedPrompt }] });
    const generate = createGenerateCodexImage(fake.createClient);

    await expect(generate({ cwd: "/repo", prompt: "A blue coin" })).resolves.toEqual({ sourcePath: GENERATED_PATH });
    expect(fake.closed()).toBe(true);
  });

  test.each([
    { images: [] },
    { images: [{ savedPath: "relative.png" }] },
  ])("rejects a completed turn without a usable absolute image path (%j)", async ({ images }) => {
    const fake = fakeCodex({ images });
    const generate = createGenerateCodexImage(fake.createClient);

    await expect(generate({ cwd: "/repo", prompt: "A blue coin" })).rejects.toThrow("without producing a saved image");
    expect(fake.closed()).toBe(true);
  });
});
