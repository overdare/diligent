// @summary Tests for AGENT.md frontmatter parsing and validation
import { describe, expect, it } from "bun:test";
import { parseAgentFrontmatter, validateAgentName } from "../../src/agents/frontmatter";

describe("parseAgentFrontmatter", () => {
  it("parses valid frontmatter with tools and model_class", () => {
    const content = [
      "---",
      "name: code-reviewer",
      "description: Reviews code",
      "tools: read, glob, grep",
      "model_class: general",
      "---",
      "Review carefully.",
    ].join("\n");

    const result = parseAgentFrontmatter(content, "/tmp/AGENT.md");
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.frontmatter.name).toBe("code-reviewer");
    expect(result.frontmatter.tools).toEqual(["read", "glob", "grep"]);
    expect(result.frontmatter.model_class).toBe("general");
    expect(result.body).toBe("Review carefully.");
  });

  it("deduplicates tools", () => {
    const content = [
      "---",
      "name: reviewer",
      "description: Reviews code",
      "tools: read, glob, read",
      "---",
      "Review carefully.",
    ].join("\n");

    const result = parseAgentFrontmatter(content, "/tmp/AGENT.md");
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.frontmatter.tools).toEqual(["read", "glob"]);
  });

  it("passes through unknown tool names with a warning instead of rejecting", () => {
    const content = [
      "---",
      "name: reviewer",
      "description: Reviews code",
      "tools: read, mystery_tool",
      "---",
      "Review carefully.",
    ].join("\n");

    const result = parseAgentFrontmatter(content, "/tmp/AGENT.md");
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.frontmatter.tools).toContain("mystery_tool");
  });

  it("rejects invalid model_class", () => {
    const content = ["---", "name: reviewer", "description: Reviews code", "model_class: ultra", "---", "Body"].join(
      "\n",
    );
    const result = parseAgentFrontmatter(content, "/tmp/AGENT.md");
    expect("error" in result).toBe(true);
  });

  it("rejects empty body", () => {
    const content = ["---", "name: reviewer", "description: Reviews code", "---", "", "  "].join("\n");
    const result = parseAgentFrontmatter(content, "/tmp/AGENT.md");
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error).toContain("must not be empty");
  });
});

describe("validateAgentName", () => {
  it("returns null for matching name and directory", () => {
    expect(validateAgentName("code-reviewer", "code-reviewer")).toBeNull();
  });

  it("returns an error for mismatched directory name", () => {
    expect(validateAgentName("code-reviewer", "reviewer")).toContain("must match directory name");
  });
});
