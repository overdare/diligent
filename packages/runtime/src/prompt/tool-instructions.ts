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
      "Use search_memory to recall project context that the memory index does not show and to find an existing memory before revising it.",
    );
  }
  if (names.has("update_memory")) {
    instructions.push(
      "Use update_memory to keep this project's memory current for future sessions: decisions and why they were made, remaining work, where references live, and the user's durable preferences and corrections. Revise the existing memory when one covers the same topic, and delete one that is no longer true.",
      "Do not store the current request, transient plans, or details already recorded in code, project docs, or git history.",
    );
  }
  if (instructions.length > 0) {
    result.push({ label: "memory_instruction", content: instructions.join("\n") });
  }
  return result;
}
