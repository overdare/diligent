---
name: prompt-writing
description: Write, review, or trim prompts for current frontier LLMs — system prompts, skills (SKILL.md and descriptions), AGENTS.md, and agent or subagent prompts. Use when authoring or auditing one of these, not for ordinary docs or code comments.
---

# Prompt Writing

Read [references/guide.md](references/guide.md) and apply the sections that match the artifact:

| Artifact | Sections |
|---|---|
| Any prompt | §1 (instructions age with the LLM), §4 (redundant verification), §5 (scope, boundaries, completion) |
| System prompt | §3.2, §6, §7, §8 if reasoning is disabled |
| Skill | §3.1 (descriptions, progressive disclosure, guidance over itineraries) |
| `AGENTS.md` | §3.2, §5.2 |
| Agent or subagent prompt | §2, §5.4, §6 |

§9 is a checklist per artifact type; use it for audits.

When auditing an existing prompt, check each instruction against the code and tools it describes, not only against the guide: stale tool names, parameters, and facts are as harmful as outdated style. Keep facts the model cannot discover elsewhere, move task-specific detail into skills or tool descriptions, and drop what the model already does on its own.
