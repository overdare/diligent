// @summary Tests for system prompt building with memory injection
import { describe, expect, it } from "bun:test";
import { flattenSections } from "@diligent/core/prompt-contract";
import { buildSystemPromptWithMemory } from "@diligent/runtime/config";

describe("buildSystemPromptWithMemory", () => {
  it("includes memory section in system prompt", () => {
    const result = buildSystemPromptWithMemory("Base prompt", [], "## Project Memory\n- [pattern] Use Bun\n");
    const flat = flattenSections(result);
    expect(flat).toContain("Base prompt");
    expect(flat).toContain("## Project Memory");
    expect(flat).toContain("[pattern] Use Bun");
    expect(result.some((section) => section.label === "memory_instruction")).toBe(false);
  });

  it("includes instructions after memory section", () => {
    const result = buildSystemPromptWithMemory(
      "Base",
      [{ path: "/project/AGENTS.md", content: "Project rules" }],
      "## Project Memory\n- [pattern] Use Bun\n",
    );

    const flat = flattenSections(result);
    const memoryPos = flat.indexOf("Project Memory");
    const instructionsPos = flat.indexOf("Project rules");
    expect(memoryPos).toBeLessThan(instructionsPos);
  });

  it("omits memory section when empty", () => {
    const result = buildSystemPromptWithMemory("Base", [], "");
    const flat = flattenSections(result);
    expect(flat).not.toContain("## Project Memory");
    expect(result.some((section) => section.label === "memory_instruction")).toBe(false);
  });

  it("includes additional instructions", () => {
    const result = buildSystemPromptWithMemory("Base", [], "", ["Custom instruction 1"]);
    const flat = flattenSections(result);
    expect(flat).toContain("Custom instruction 1");
  });

  it("includes agents section when provided", () => {
    const result = buildSystemPromptWithMemory(
      "Base",
      [],
      "",
      undefined,
      undefined,
      "## Available Agents\n- **code-reviewer**",
    );
    const flat = flattenSections(result);
    expect(flat).toContain("Available Agents");
    expect(flat).toContain("code-reviewer");
  });
});
