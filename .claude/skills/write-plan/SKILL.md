---
name: write-plan
description: Create implementation plans for any development work. Use this skill whenever the user says "/write-plan", asks to create an implementation plan, wants to plan a feature/refactor/fix/infra task, or asks "how should we implement X?". Also use when the user wants to break down a task into implementable steps.
---

# Implementation Plan Writer

Creates detailed, implementable plans for development work on the diligent project. Plans are organized by type under `docs/plan/` and bridge the gap between "what we want" and "what we build."

## Plan Types

| Type | Folder | When to use |
|------|--------|-------------|
| `feature` | `docs/plan/feature/` | New user-facing capability |
| `refactor` | `docs/plan/refactor/` | Structural improvement, code reorganization |
| `fix` | `docs/plan/fix/` | Complex bug fix that needs investigation and planning |
| `infra` | `docs/plan/infra/` | Build, CI, deployment, test infrastructure |

## Context Sources

Before generating any plan, read these project files to build context:

| File | What it provides |
|------|-----------------|
| `ARCHITECTURE.md` | System architecture, layer overview, design principles |
| `BACKLOG.md` | Pending work items — check if the task is already tracked |
| `docs/plan/decisions.md` | Design decisions (D001-D078+) with rationale |

Then read source code relevant to the task. Use `/glob-aug` to explore unfamiliar areas efficiently.

## Workflow

**Enter plan mode first.** Use the EnterPlanMode tool before starting. Plan mode gives you read-only access to explore the codebase without making changes, which is exactly what you need for Steps 1–3. Write the final plan file in Step 4 after exiting plan mode.

### Step 1: Identify the Target

Determine what to plan. The user might say:
- `/write-plan mcp-client` — explicit topic
- `/write-plan` — ask what they want to plan
- "Let's plan how to add X" — infer from conversation

Determine the plan type (feature/refactor/fix/infra). If unclear, ask.

### Step 2: Read Context

1. Read `ARCHITECTURE.md` for relevant architectural context
2. Read source code in the areas this plan will touch
3. Read `docs/plan/decisions.md` for referenced design decisions
4. Read existing plans in the same category for format consistency

This reading step is not optional. Plans that don't account for existing architecture create contradictions.

### Step 3: Interactive Scoping

Before writing anything, resolve ambiguity with the user. Goal: zero assumptions before drafting.

**Scope boundaries:**
- "This touches X and Y. Anything you want to defer or prioritize?"
- "Should this cover both TUI and Web, or one first?"

**Implementation approach:**
- "decisions.md says [D0XX] for this. Still the plan, or has thinking changed?"
- "I see two approaches: A and B. Preference?"

**Definition of done:**
- "What does 'done' look like? What would you demo?"
- "Any edge cases you're worried about?"

Use judgment — skip what's obvious, dig into what's ambiguous.

### Step 4: Draft the Plan

**Assign the next plan ID:** Grep all `docs/plan/` files for `id: P` to find the highest existing number, then increment by 1.

Write the plan to the appropriate folder with the ID prefix:
- `docs/plan/{type}/PNNN-{name}.md`

File naming: `PNNN-` prefix + lowercase kebab-case. Examples:
- `docs/plan/feature/P016-mcp-client.md`
- `docs/plan/refactor/P017-provider-abstraction.md`
- `docs/plan/fix/P018-compaction-token-drift.md`

Read `references/plan-template.md` before writing — it contains the full template.

Key principles:
- **Every file touched gets listed.** No guessing "what else?"
- **Code sketches, not pseudocode.** Actual TypeScript interfaces and signatures.
- **Decisions cited inline.** Reference as (D0XX) where used.
- **Negative scope is explicit.** What this plan does NOT include.
- **Tasks are ordered.** Dependency-aware sequence.

### Step 5: Review and Iterate

After generating the draft:
1. Highlight uncertain decisions or ambiguous areas
2. Ask the user to review — focus on scope and task ordering
3. Iterate until the plan is followable without questions

## References

### references/plan-template.md
Full plan template with section descriptions. Read before generating any plan.
