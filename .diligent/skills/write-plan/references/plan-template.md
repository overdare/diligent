# Implementation Plan Template

When a persisted plan is requested, use `docs/plan/{type}/{name}.md` and a frontmatter status block. Scale the sections below to the task; omit sections that add no implementation decision.

---

## Template

```markdown
---
id: PNNN
status: backlog
created: YYYY-MM-DD
---

# [Title]

## Goal

[1-2 sentences. What capability exists after this is done that didn't exist before? Write as a user-visible outcome.]

## Prerequisites

- [What must already exist — specific modules, interfaces, infrastructure]
- [If none, write "None."]

## Artifact

[What the user can demonstrate when complete. Include a concrete interaction example if applicable:]

\```
User → "example input"
Agent → [what happens]
Agent → "example output"
\```

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| packages/core/src/agent | Loop modification for X |
| packages/cli/src/tui | New overlay component |
| ... | ... |

### What does NOT change

[Explicit negative scope. Prevents scope creep. Be specific.]

- No X support (tracked separately in backlog)
- No Y (out of scope for this plan)

## File Manifest

[Known files and ownership boundaries. Group by directory when useful; leave routine file discovery to implementation.]

### packages/core/src/example/

| File | Action | Description |
|------|--------|------------|
| `handler.ts` | CREATE | Request handler implementation |
| `types.ts` | MODIFY | Add new event types |

[Add other relevant areas.]

## Implementation Tasks

[Ordered sequence. Each task is independently testable. Dependencies flow top-to-bottom.]

### Task 1: [Name]

**Files:** `path/to/file.ts`, `path/to/other.ts`
**Decisions:** D0XX (if applicable)

[Description. Include interface or signature sketches only when they resolve a consequential design choice.]

\```typescript
// Code sketch — copy-paste and fill in the body
export interface NewThing {
  // ...
}
\```

**Verify:** [How to check this task is done]

### Task 2: [Name]

[Same structure.]

## Acceptance Criteria

[Numbered list. Each criterion is binary — passes or fails.]

1. [Relevant automated checks pass]
2. [Specific functional criterion]
3. [Integration criterion]
4. No `any` type escape hatches in new code

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | [component] | `bun test` with mocks |
| Integration | [flow] | End-to-end scenario |
| Manual | [interaction] | Run and verify |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| [risk] | [impact] | [mitigation] |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D0XX | [summary] | [task/section] |
```

---

## Frontmatter Fields

| Field | Description |
|-------|-------------|
| `id` | Sequential plan ID: `PNNN`. Check existing plans for the next number. |
| `status` | `backlog` → `in-progress` → `done` (or `dropped`) |
| `created` | Date the plan was written (YYYY-MM-DD) |

Update status as work progresses.

## Format Notes

- **File Manifest** answers "how big is this?" at a glance and doubles as a checklist
- **Implementation Tasks** give a dependency-aware work order — task N builds on task N-1
- **Negative scope** is as important as positive scope — it prevents "while I'm here" creep
- **Code sketches** clarify interfaces when needed; they do not prescribe routine implementation details
- **Decisions** cite existing records when relevant; do not invent decision IDs
