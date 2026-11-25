// @summary Keep tool-specific system instructions aligned with the available tool catalog
import type { SystemSection } from "@diligent/core/provider-contract";

export function withToolInstructions(sections: SystemSection[], tools: readonly { name: string }[]): SystemSection[] {
  const names = new Set(tools.map((tool) => tool.name));
  const result = sections.filter(
    (section) =>
      section.label !== "memory_instruction" &&
      (names.has("skill") || !["skills", "skill_usage_guardrail"].includes(section.label)),
  );
  const instructions: string[] = [];
  if (names.has("search_memory")) {
    instructions.push(
      "Use search_memory to recall durable user preferences and locate an existing entry before revising it.",
    );
  }
  if (names.has("update_memory")) {
    instructions.push(
      "Use update_memory only for durable user preferences, with type='preference'. Update an existing entry when it covers the same preference.",
      "Do not store immediate task intent, implementation plans, discoveries, backlog items, or records of completed work.",
    );
  }
  if (instructions.length > 0) {
    result.push({ label: "memory_instruction", content: instructions.join("\n") });
  }
  return result;
}
