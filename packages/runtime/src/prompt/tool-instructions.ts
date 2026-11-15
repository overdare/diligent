// @summary Keep tool-specific system instructions aligned with the available tool catalog
import type { SystemSection } from "@diligent/core/provider-contract";

export function withToolInstructions(sections: SystemSection[], tools: readonly { name: string }[]): SystemSection[] {
  const names = new Set(tools.map((tool) => tool.name));
  const result = sections.filter(
    (section) =>
      section.label !== "knowledge_instruction" &&
      (names.has("skill") || !["skills", "skill_usage_guardrail"].includes(section.label)),
  );
  const instructions: string[] = [];
  if (names.has("search_knowledge")) {
    instructions.push(
      "Use search_knowledge to recall durable user preferences and locate an existing entry before revising it.",
    );
  }
  if (names.has("update_knowledge")) {
    instructions.push(
      "Use update_knowledge only for durable user preferences, with type='preference'. Update an existing entry when it covers the same preference.",
      "Do not store immediate task intent, implementation plans, discoveries, backlog items, or records of completed work.",
    );
  }
  if (instructions.length > 0) {
    result.push({ label: "knowledge_instruction", content: instructions.join("\n") });
  }
  return result;
}
