// @summary Tests for stream resolver requiring explicit runtime configuration
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { configureStreamResolver, resetStreamResolver, resolveStream } from "./stream-resolver";

beforeEach(() => {
  resetStreamResolver();
});

afterEach(() => {
  resetStreamResolver();
});

describe("resolveStream", () => {
  test("throws when runtime has not configured a resolver", () => {
    expect(() => resolveStream("anthropic")).toThrow('No stream resolver configured for provider "anthropic"');
  });

  test("uses the configured resolver when present", () => {
    const streamFn = (() => {
      throw new Error("unused");
    }) as ReturnType<typeof resolveStream>;
    configureStreamResolver(() => streamFn);
    expect(resolveStream("anthropic")).toBe(streamFn);
  });
});
