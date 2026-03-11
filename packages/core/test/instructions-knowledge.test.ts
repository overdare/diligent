// @summary Tests for system prompt building with knowledge injection
import { describe, expect, it } from "bun:test";
import { buildSystemPromptWithKnowledge } from "../src/config/instructions";
import { flattenSections } from "../src/provider/system-sections";

describe("buildSystemPromptWithKnowledge", () => {
  it("includes knowledge section in system prompt", () => {
    const result = buildSystemPromptWithKnowledge("Base prompt", [], "## Project Knowledge\n- [pattern] Use Bun\n");
    const flat = flattenSections(result);
    expect(flat).toContain("Base prompt");
    expect(flat).toContain("## Project Knowledge");
    expect(flat).toContain("[pattern] Use Bun");
    expect(flat).toContain("add_knowledge tool");
  });

  it("includes instructions after knowledge section", () => {
    const result = buildSystemPromptWithKnowledge(
      "Base",
      [{ path: "/project/AGENTS.md", content: "Project rules" }],
      "## Project Knowledge\n- [pattern] Use Bun\n",
    );

    const flat = flattenSections(result);
    const knowledgePos = flat.indexOf("Project Knowledge");
    const instructionsPos = flat.indexOf("Project rules");
    expect(knowledgePos).toBeLessThan(instructionsPos);
  });

  it("omits knowledge section when empty", () => {
    const result = buildSystemPromptWithKnowledge("Base", [], "");
    const flat = flattenSections(result);
    expect(flat).not.toContain("## Project Knowledge");
    expect(flat).toContain("add_knowledge tool");
  });

  it("includes additional instructions", () => {
    const result = buildSystemPromptWithKnowledge("Base", [], "", ["Custom instruction 1"]);
    const flat = flattenSections(result);
    expect(flat).toContain("Custom instruction 1");
  });
});
