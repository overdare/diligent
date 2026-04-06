// @summary Tests default tool assembly gating for provider-native web tools
import { describe, expect, test } from "bun:test";
import { buildDefaultTools } from "../../src/tools/defaults";

describe("buildDefaultTools web gating", () => {
  test("includes provider-native web placeholder tool by default", async () => {
    const result = await buildDefaultTools({ cwd: "/tmp" });
    const names = result.tools.map((tool) => tool.name);

    expect(names).toContain("web_action");
  });

  test("omits provider-native web placeholder tool when tools.web_action is false", async () => {
    const result = await buildDefaultTools({ cwd: "/tmp", toolsConfig: { web_action: false } });
    const names = result.tools.map((tool) => tool.name);

    expect(names).not.toContain("web_action");
    expect(result.toolState.find((entry) => entry.name === "web_action")).toBeUndefined();
  });
});
