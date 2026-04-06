// @summary Tests for provider-native web built-in tools and metadata exposure
import { describe, expect, test } from "bun:test";
import type { ToolContext } from "@diligent/core/tool/types";
import { createWebTool } from "@diligent/runtime/tools";
import { TOOL_CAPABILITIES } from "../../src/tools/tool-metadata";

function makeCtx(): ToolContext {
  return {
    toolCallId: "tc_1",
    signal: new AbortController().signal,
    abort: () => {},
  };
}

describe("provider-native web built-ins", () => {
  test("tool metadata marks web as a provider built-in", () => {
    expect(TOOL_CAPABILITIES.web).toMatchObject({
      executionMode: "provider_builtin",
      providerCapability: "web",
    });
  });

  test("web placeholder tool is exposed for catalog/config flows", async () => {
    const tool = createWebTool();
    expect(tool.name).toBe("web");
    expect(tool.description).toContain("native web capability");

    const result = await tool.execute({ query: "diligent" }, makeCtx());
    expect(result.output).toContain("should not execute locally");
  });
});
