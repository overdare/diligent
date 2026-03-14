// @summary Tests for static stream resolver behavior
import { describe, expect, test } from "bun:test";
import { resolveStream } from "./stream-resolver";

describe("resolveStream", () => {
  test("throws when no static stream factory exists for provider", () => {
    expect(() => resolveStream("anthropic")).toThrow(
      'No static stream function for provider "anthropic". Provide llmMsgStreamFn via AgentOptions for authenticated providers.',
    );
  });
});
