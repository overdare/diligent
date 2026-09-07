// @summary Tests Codex account, capability, thread, and image-event orchestration without a real process.

import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CodexAppServerSession,
  CodexNotification,
  ConnectCodexAppServer,
} from "../../../src/tools/codex-imagegen/app-server-client";
import { createGenerateCodexImage } from "../../../src/tools/codex-imagegen/generate";

interface FakeOptions {
  accountType?: string;
  imageGeneration?: boolean;
  notifications?: CodexNotification[];
}

const GENERATED_PATH = join(tmpdir(), "codex-image.png");

function fakeCodex(options: FakeOptions = {}): {
  connect: ConnectCodexAppServer;
  requests: Array<{ method: string; params?: Record<string, unknown> }>;
} {
  const requests: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const session: CodexAppServerSession = {
    async request(method, params) {
      requests.push({ method, params });
      if (method === "account/read") {
        return { account: { type: options.accountType ?? "chatgpt" }, requiresOpenaiAuth: true };
      }
      if (method === "modelProvider/capabilities/read") {
        return { imageGeneration: options.imageGeneration ?? true, namespaceTools: true, webSearch: true };
      }
      if (method === "thread/start") return { thread: { id: "thread-1" } };
      if (method === "turn/start") return { turn: { id: "turn-1" } };
      throw new Error(`Unexpected request: ${method}`);
    },
    notify() {},
    async waitForNotification(match) {
      for (const notification of options.notifications ?? [
        {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            item: {
              type: "imageGeneration",
              savedPath: GENERATED_PATH,
              revisedPrompt: "refined",
            },
          },
        },
        {
          method: "turn/completed",
          params: { threadId: "thread-1", turn: { status: "completed", error: null } },
        },
      ]) {
        const value = match(notification);
        if (value !== undefined) return value;
      }
      throw new Error("No notification matched");
    },
  };
  const connect: ConnectCodexAppServer = async (input) => input.run(session);
  return { connect, requests };
}

describe("Codex image generation orchestration", () => {
  test("checks managed OAuth and capability before running one ephemeral image turn", async () => {
    const fake = fakeCodex();
    const generate = createGenerateCodexImage(fake.connect);

    await expect(generate({ cwd: "/repo", prompt: "A blue coin" })).resolves.toEqual({
      sourcePath: GENERATED_PATH,
      revisedPrompt: "refined",
    });
    expect(fake.requests.map(({ method }) => method)).toEqual([
      "account/read",
      "modelProvider/capabilities/read",
      "thread/start",
      "turn/start",
    ]);
    expect(fake.requests[2]?.params).toMatchObject({ cwd: "/repo", ephemeral: true });
    expect(fake.requests[3]?.params).toMatchObject({
      threadId: "thread-1",
      cwd: "/repo",
      input: [{ type: "text", text: "$imagegen\nA blue coin" }],
    });
  });

  test("rejects non-managed authentication before checking image capability", async () => {
    const fake = fakeCodex({ accountType: "apiKey" });
    const generate = createGenerateCodexImage(fake.connect);

    await expect(generate({ cwd: "/repo", prompt: "A blue coin" })).rejects.toThrow("managed ChatGPT OAuth");
    expect(fake.requests.map(({ method }) => method)).toEqual(["account/read"]);
  });

  test("rejects accounts without the Codex image-generation capability", async () => {
    const fake = fakeCodex({ imageGeneration: false });
    const generate = createGenerateCodexImage(fake.connect);

    await expect(generate({ cwd: "/repo", prompt: "A blue coin" })).rejects.toThrow(
      "does not support image generation",
    );
    expect(fake.requests.map(({ method }) => method)).toEqual(["account/read", "modelProvider/capabilities/read"]);
  });

  test("surfaces the failed turn reason instead of reporting a missing image", async () => {
    const fake = fakeCodex({
      notifications: [
        {
          method: "turn/completed",
          params: { threadId: "thread-1", turn: { status: "failed", error: { message: "quota exhausted" } } },
        },
      ],
    });
    const generate = createGenerateCodexImage(fake.connect);

    await expect(generate({ cwd: "/repo", prompt: "A blue coin" })).rejects.toThrow("quota exhausted");
  });
});
