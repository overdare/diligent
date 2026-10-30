// @summary Tests for uploading Anthropic images once and referencing them by file_id
import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicImageFiles, getAnthropicImageFiles } from "../../../../src/llm/provider/anthropic/image-files";

const image = (data: string): Anthropic.ImageBlockParam => ({
  type: "image",
  source: { type: "base64", media_type: "image/png", data },
});

const conversation = (): Anthropic.MessageParam[] => [
  { role: "user", content: [{ type: "text", text: "look" }, image("aW1hZ2UtYQ==")] },
  { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "read_image", input: {} }] },
  {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: "call_1",
        content: [{ type: "text", text: "loaded" }, image("aW1hZ2UtYg==")],
      },
      { ...image("aW1hZ2UtYQ=="), cache_control: { type: "ephemeral" } },
    ],
  },
];

describe("AnthropicImageFiles", () => {
  test("replaces every base64 image with a file reference and uploads each distinct image once", async () => {
    const uploads: string[] = [];
    const files = new AnthropicImageFiles(async (bytes) => {
      uploads.push(bytes.toString());
      return `file_${uploads.length}`;
    });

    const first = await files.reference(conversation());
    const second = await files.reference(conversation());

    expect(uploads).toEqual(["image-a", "image-b"]);
    expect(first.usesFiles).toBe(true);
    expect(second.messages).toEqual(first.messages);
    // The installed SDK types omit the `file` image source the Messages API accepts.
    const referenced: unknown[] = first.messages.map((message) => message.content);
    expect(referenced[0]).toEqual([
      { type: "text", text: "look" },
      { type: "image", source: { type: "file", file_id: "file_1" } },
    ]);
    expect(referenced[2]).toEqual([
      {
        type: "tool_result",
        tool_use_id: "call_1",
        content: [
          { type: "text", text: "loaded" },
          { type: "image", source: { type: "file", file_id: "file_2" } },
        ],
      },
      { type: "image", source: { type: "file", file_id: "file_1" }, cache_control: { type: "ephemeral" } },
    ]);
  });

  test("keeps images inline and stops uploading after an upload fails", async () => {
    let attempts = 0;
    const files = new AnthropicImageFiles(async () => {
      attempts += 1;
      throw new Error("files api unavailable");
    });

    const first = await files.reference([{ role: "user", content: [image("aW1hZ2UtYQ==")] }]);
    const second = await files.reference([{ role: "user", content: [image("aW1hZ2UtYg==")] }]);

    expect(first.usesFiles).toBe(false);
    expect(first.messages[0]?.content).toEqual([image("aW1hZ2UtYQ==")]);
    expect(second.messages[0]?.content).toEqual([image("aW1hZ2UtYg==")]);
    expect(attempts).toBe(1);
  });
});

describe("getAnthropicImageFiles", () => {
  test("uses the Files API only on the official endpoint", () => {
    expect(getAnthropicImageFiles("key", "https://api.anthropic.com")).toBeInstanceOf(AnthropicImageFiles);
    expect(getAnthropicImageFiles("key", "https://api.anthropic.com/v1")).toBeInstanceOf(AnthropicImageFiles);
    expect(getAnthropicImageFiles("key", "https://gateway.example.com")).toBeUndefined();
  });
});
