// @summary Tests for codex-like Diligent protocol flow schemas (thread/turn/item + callbacks)
import { describe, expect, it } from "bun:test";
import {
  DILIGENT_CLIENT_REQUEST_METHODS,
  DILIGENT_SERVER_NOTIFICATION_METHODS,
  DILIGENT_SERVER_REQUEST_METHODS,
  DILIGENT_WEB_REQUEST_METHODS,
  DiligentClientRequestSchema,
  DiligentServerNotificationSchema,
  DiligentServerRequestResponseSchema,
  DiligentServerRequestSchema,
  DiligentWebResponseSchema,
} from "../src";

describe("protocol/flow", () => {
  it("accepts thread and turn client requests", () => {
    expect(
      DiligentClientRequestSchema.safeParse({
        method: DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START,
        params: { cwd: "/tmp/work" },
      }).success,
    ).toBe(true);

    expect(
      DiligentClientRequestSchema.safeParse({
        method: DILIGENT_CLIENT_REQUEST_METHODS.TURN_START,
        params: { threadId: "th-1", message: "hello" },
      }).success,
    ).toBe(true);

    expect(
      DiligentClientRequestSchema.safeParse({
        method: DILIGENT_CLIENT_REQUEST_METHODS.TURN_START,
        params: {
          threadId: "th-1",
          message: "",
          attachments: [
            {
              type: "local_image",
              path: "/tmp/shot.png",
              mediaType: "image/png",
              fileName: "shot.png",
            },
          ],
          content: [{ type: "local_image", path: "/tmp/shot.png", mediaType: "image/png", fileName: "shot.png" }],
        },
      }).success,
    ).toBe(true);
  });

  it("accepts web image upload responses with canonical webUrl", () => {
    expect(
      DiligentWebResponseSchema.safeParse({
        method: DILIGENT_WEB_REQUEST_METHODS.IMAGE_UPLOAD,
        result: {
          attachment: {
            type: "local_image",
            path: "/repo/.diligent/images/thread-1/shot.png",
            mediaType: "image/png",
            fileName: "shot.png",
            webUrl: "/_diligent/image/thread-1/shot.png",
          },
        },
      }).success,
    ).toBe(true);
  });

  it("accepts codex-like item lifecycle notifications", () => {
    const itemStarted = DiligentServerNotificationSchema.safeParse({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_STARTED,
      params: {
        threadId: "th-1",
        turnId: "turn-1",
        item: {
          type: "agentMessage",
          itemId: "item-1",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "hi" }],
            model: "claude-sonnet-4-6",
            usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
            stopReason: "end_turn",
            timestamp: Date.now(),
          },
        },
      },
    });
    expect(itemStarted.success).toBe(true);

    const itemDelta = DiligentServerNotificationSchema.safeParse({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_DELTA,
      params: {
        threadId: "th-1",
        turnId: "turn-1",
        itemId: "item-1",
        delta: { type: "messageText", itemId: "item-1", delta: "more" },
      },
    });
    expect(itemDelta.success).toBe(true);

    const itemCompleted = DiligentServerNotificationSchema.safeParse({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_COMPLETED,
      params: {
        threadId: "th-1",
        turnId: "turn-1",
        item: {
          type: "toolCall",
          itemId: "item-2",
          toolCallId: "tc-1",
          toolName: "bash",
          input: { cmd: "pwd" },
          output: "/tmp/work",
          isError: false,
        },
      },
    });
    expect(itemCompleted.success).toBe(true);
  });

  it("accepts approval and user-input server callback requests", () => {
    const approvalReq = DiligentServerRequestSchema.safeParse({
      method: DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST,
      params: {
        threadId: "th-1",
        request: {
          permission: "write",
          toolName: "write_file",
          description: "write src/index.ts",
        },
      },
    });
    expect(approvalReq.success).toBe(true);

    const approvalRes = DiligentServerRequestResponseSchema.safeParse({
      method: DILIGENT_SERVER_REQUEST_METHODS.APPROVAL_REQUEST,
      result: { decision: "once" },
    });
    expect(approvalRes.success).toBe(true);

    const userInputReq = DiligentServerRequestSchema.safeParse({
      method: DILIGENT_SERVER_REQUEST_METHODS.USER_INPUT_REQUEST,
      params: {
        threadId: "th-1",
        request: {
          questions: [{ id: "q1", header: "Need path", question: "file path?", options: [] }],
        },
      },
    });
    expect(userInputReq.success).toBe(true);
  });

  it("rejects malformed flow payloads", () => {
    const bad = DiligentServerNotificationSchema.safeParse({
      method: DILIGENT_SERVER_NOTIFICATION_METHODS.ITEM_DELTA,
      params: {
        threadId: "th-1",
        turnId: "turn-1",
        // missing itemId
        delta: { type: "messageText", itemId: "item-1", delta: "x" },
      },
    });

    expect(bad.success).toBe(false);
  });
});
