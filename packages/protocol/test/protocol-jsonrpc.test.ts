// @summary Tests for Diligent protocol JSON-RPC lite envelope schemas
import { describe, expect, it } from "bun:test";
import {
  JSONRPCErrorResponseSchema,
  JSONRPCMessageSchema,
  JSONRPCNotificationSchema,
  JSONRPCRequestSchema,
  JSONRPCResponseSchema,
} from "../src";

describe("protocol/jsonrpc", () => {
  it("accepts request without jsonrpc field (lite)", () => {
    const result = JSONRPCRequestSchema.safeParse({
      id: "req-1",
      method: "turn/start",
      params: { message: "hello" },
    });

    expect(result.success).toBe(true);
  });

  it("accepts notifications without id", () => {
    const result = JSONRPCNotificationSchema.safeParse({
      method: "thread/started",
      params: { threadId: "th-1" },
    });

    expect(result.success).toBe(true);
  });

  it("accepts success and error responses", () => {
    expect(
      JSONRPCResponseSchema.safeParse({
        id: 1,
        result: { ok: true },
      }).success,
    ).toBe(true);

    expect(
      JSONRPCErrorResponseSchema.safeParse({
        id: 1,
        error: { code: -32000, message: "boom" },
      }).success,
    ).toBe(true);
  });

  it("rejects malformed message envelope", () => {
    const result = JSONRPCMessageSchema.safeParse({
      params: {},
    });

    expect(result.success).toBe(false);
  });
});
