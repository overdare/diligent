---
name: write-plan
description: Draft an implementation plan when the user requests a plan for a feature, fix, refactor, or infrastructure change.
---

# Implementation Plan

Turn the requested outcome into a plan another engineer can implement. Resolve consequential unknowns while leaving routine implementation choices to that engineer.

Use the current collaboration mode and available tools. This skill does not switch modes or grant permission to edit files. In Plan Mode, explore read-only and return the plan in the required response format. Save a plan only when the user requests a file and the current mode permits writing.

## Context

Use `ARCHITECTURE.md` for affected package boundaries and `docs/guide/` for relevant behavior. Inspect current code and tests. Consult existing plans or decisions only when they exist and matter to the task; plans are not proof of implemented behavior.

Discover facts from the repository before asking. Ask about preferences or missing requirements only when they materially change the scope, design, or acceptance criteria. Do not store task plans or backlog items as persistent user preferences.

## Plan content

Cover the intended outcome, affected contracts and ownership, implementation sequence, meaningful regression scenarios, and material assumptions. Include migrations or compatibility work only when needed. Name known affected files without pretending the list cannot evolve.

Read `references/plan-template.md` when saving a substantial plan, and omit sections that do not help the task.

When the user requests a saved plan, follow existing naming conventions under `docs/plan/{feature|refactor|fix|infra}/`. Use the next existing plan ID when that convention is present; otherwise use a descriptive kebab-case filename. Create directories only when writing is authorized.

Finish when consequential decisions and acceptance criteria are clear. Surface unresolved essential inputs explicitly rather than guessing or requiring approval for routine details.
