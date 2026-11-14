// @summary Tests for rendering discovered agents into the system prompt
import { describe, expect, it } from "bun:test";
import { renderAgentsSection } from "../../src/agents/render";

describe("renderAgentsSection", () => {
  it("returns empty string when no agents exist", () => {
    expect(renderAgentsSection([])).toBe("");
  });

  it("renders name, description, tools, and model class", () => {
    const result = renderAgentsSection([
      {
        name: "code-reviewer",
        description: "Reviews code",
        filePath: "/tmp/code-reviewer/AGENT.md",
        content: "Review carefully.",
        tools: ["read", "glob"],
        defaultModelClass: "general",
        source: "project",
      },
    ]);

    expect(result).toContain("Available Agents");
    expect(result).toContain("code-reviewer");
    expect(result).toContain("Reviews code");
    expect(result).toContain("read, glob");
    expect(result).toContain("general");
  });
});
