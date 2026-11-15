// @summary Prompt contracts follow the final available tool set
import { describe, expect, test } from "bun:test";
import { withToolInstructions } from "../../src/prompt/tool-instructions";

describe("withToolInstructions", () => {
  const base = [
    { label: "base", content: "Shared rules" },
    { label: "knowledge_instruction", content: "stale" },
  ];

  test("removes stale knowledge instructions when no knowledge tools are available", () => {
    expect(withToolInstructions(base, [])).toEqual([base[0]]);
  });

  test("omits skill invocation guidance when the skill tool is filtered out", () => {
    const prompt = [
      base[0]!,
      { label: "skills", content: "Call skill to load a workflow" },
      { label: "skill_usage_guardrail", content: "Do not read SKILL.md directly" },
    ];
    expect(withToolInstructions(prompt, [{ name: "read" }])).toEqual([base[0]!]);
    expect(withToolInstructions(prompt, [{ name: "skill" }])).toEqual(prompt);
  });

  test("read-only knowledge access never instructs the model to persist preferences", () => {
    const prompt = withToolInstructions(base, [{ name: "search_knowledge" }]);
    const instruction = prompt.find((section) => section.label === "knowledge_instruction")?.content ?? "";
    expect(instruction).toContain("search_knowledge");
    expect(instruction).not.toContain("update_knowledge");
    expect(instruction).not.toContain("stale");
  });

  test("write-only knowledge access does not invent a search capability", () => {
    const prompt = withToolInstructions(base, [{ name: "update_knowledge" }]);
    const instruction = prompt.find((section) => section.label === "knowledge_instruction")?.content ?? "";
    expect(instruction).toContain("update_knowledge");
    expect(instruction).toContain("durable user preferences");
    expect(instruction).not.toContain("search_knowledge");
  });
});
