---
id: P013
status: done
created: 2026-03-02
---

status: backlog
---

# Approval System + request_user_input

## Goal

The agent asks for permission before executing risky actions (bash, write, edit), and can ask
the user clarifying questions mid-task. Both interactions block the agent loop until the user
responds via a TUI overlay.

## Prerequisites

- Phase 4c artifacts: collaboration modes, TUI component framework (ConfirmDialog, TextInput,
  ListPicker overlays), OverlayStack, `ctx.approve()` stub in loop.ts returning `"once"`.
- `ApprovalRequest`, `ApprovalResponse`, `ToolContext` types already defined in
  `packages/core/src/tool/types.ts` (D086).
- `ConfirmDialog` (2-choice) and `TextInput` overlay already exist in
  `packages/cli/src/tui/components/`.

## Artifact

**Demo 1 — First bash call prompts for permission:**
```
diligent> refactor auth.ts to use async/await

[tool:bash] ls src/
  ┌─ Permission Request ─────────────────────────────┐
  │ bash wants to execute a command                   │
  │ Command: ls src/                                  │
  │                                                   │
  │ [Once]  [Always]  [Reject]                        │
  └───────────────────────────────────────────────────┘

> user presses [Always]

[tool:bash] Done
[tool:edit] src/auth.ts   ← no dialog (write already "allowed" via config)
[tool:bash] npm test       ← no dialog ("always" for bash is now session-cached)
```

**Demo 2 — request_user_input (plan mode clarification):**
```
diligent [plan]> explore auth and propose a refactor

[tool:read_file] src/auth.ts   Done
[tool:request_user_input]
  ┌─ Question ──────────────────────────────────────────┐
  │ Should the refactor keep backward compatibility?    │
  │                                                     │
  │ > _                                                 │
  └─────────────────────────────────────────────────────┘

> user types "yes, existing API must not change"

<proposed_plan>
1. Extract AuthService interface (backward compat)
...
</proposed_plan>
```

**Demo 3 — config-based allow rule (no dialog):**
```jsonc
// diligent.jsonc
{
  "permissions": [
    { "permission": "read", "pattern": "*", "action": "allow" },
    { "permission": "write", "pattern": "src/**", "action": "allow" },
    { "permission": "execute", "pattern": "*", "action": "prompt" }
  ]
}
```
Read/write calls to src/** never prompt. Bash always prompts.

## Layer Touchpoints

| Layer | Depth | What Changes |
|-------|-------|-------------|
| L2 (Tool System) | +feature | `ToolContext` gains `ask?` callback for request_user_input |
| L4 (Approval) | FULL | `PermissionEngine` replaces auto-approve stub; session cache; denied tool filter |
| L3 (Core Tools) | +feature | `request_user_input` tool added |
| L5 (Config) | +feature | `permissions` array added to schema |
| L1 (Agent Loop) | +feature | `AgentLoopConfig` gains `approve?` + `ask?`; denied tools filtered before LLM |
| L7 (TUI) | +feature | `ApprovalDialog` (3-button) added; app.ts wires both callbacks |

**Not touched:** L0 (providers), L6 (session persistence), L8 (skills), L9 (MCP), L10 (multi-agent)

## File Manifest

### packages/core/src/approval/

| File | Action | Description |
|------|--------|-------------|
| `types.ts` | CREATE | `PermissionRule`, `PermissionEngine` interface, `UserInputRequest/Response` types |
| `engine.ts` | CREATE | `PermissionEngine` implementation — rule matching, session cache |
| `index.ts` | CREATE | Re-export public API |

### packages/core/src/tool/

| File | Action | Description |
|------|--------|-------------|
| `types.ts` | MODIFY | Add `ask?` to `ToolContext`; add `UserInputRequest/Response` types |

### packages/core/src/agent/

| File | Action | Description |
|------|--------|-------------|
| `types.ts` | MODIFY | Add `approve?` and `ask?` to `AgentLoopConfig` |
| `loop.ts` | MODIFY | Wire `ctx.approve` + `ctx.ask` from config; filter denied tools before LLM |

### packages/core/src/tools/

| File | Action | Description |
|------|--------|-------------|
| `request-user-input.ts` | CREATE | `request_user_input` tool — calls `ctx.ask()`, returns answers as JSON |
| `index.ts` | MODIFY | Add `request_user_input` to exports |

### packages/core/src/config/

| File | Action | Description |
|------|--------|-------------|
| `schema.ts` | MODIFY | Add `permissions` array to `DiligentConfigSchema` |

### packages/cli/src/tui/components/

| File | Action | Description |
|------|--------|-------------|
| `approval-dialog.ts` | CREATE | 3-button dialog: Once / Always / Reject, shows tool + description |

### packages/cli/src/tui/

| File | Action | Description |
|------|--------|-------------|
| `app.ts` | MODIFY | Build `PermissionEngine` from config; wire `approve` + `ask` callbacks to overlays |

### packages/cli/src/

| File | Action | Description |
|------|--------|-------------|
| `tools.ts` (or equivalent) | MODIFY | Pass `request_user_input` tool only when mode allows (all modes per D088) |

## Implementation Tasks

### Task 1: PermissionEngine (core, no TUI dependency)

**Files:** `packages/core/src/approval/types.ts`, `approval/engine.ts`, `approval/index.ts`
**Decisions:** D027, D028, D029

Define the rule and engine types:

```typescript
// approval/types.ts

export type PermissionAction = "allow" | "deny" | "prompt";

export interface PermissionRule {
  permission: "read" | "write" | "execute";
  pattern: string;   // wildcard — matched against toolName or path/command
  action: PermissionAction;
}

export interface PermissionEngine {
  /** Evaluate a request. Returns "allow"/"deny" if a rule decides, "prompt" if not. */
  evaluate(request: ApprovalRequest): PermissionAction;
  /** Called when user responds "always" — adds a session-scoped allow rule. */
  remember(request: ApprovalRequest, action: "allow" | "deny"): void;
}
```

Implement `PermissionEngine` in `engine.ts`:

```typescript
// approval/engine.ts
import { minimatch } from "minimatch";   // already in bun deps? check first; if not use hand-rolled *
import type { ApprovalRequest } from "../tool/types";
import type { PermissionAction, PermissionEngine, PermissionRule } from "./types";

export function createPermissionEngine(configRules: PermissionRule[]): PermissionEngine {
  // Session-scoped rules added by "always" responses (D029)
  const sessionRules: PermissionRule[] = [];

  function evaluate(request: ApprovalRequest): PermissionAction {
    // All rules: config + session, evaluated last-match-wins (D027)
    const allRules = [...configRules, ...sessionRules];
    let result: PermissionAction = "prompt"; // default when no rule matches
    const subject = request.details?.path ?? request.details?.command ?? request.toolName;
    for (const rule of allRules) {
      if (rule.permission !== request.permission) continue;
      if (wildcardMatch(rule.pattern, String(subject))) result = rule.action;
    }
    return result;
  }

  function remember(request: ApprovalRequest, action: "allow" | "deny"): void {
    const subject = request.details?.path ?? request.details?.command ?? request.toolName;
    sessionRules.push({ permission: request.permission, pattern: String(subject), action });
  }

  return { evaluate, remember };
}

// Hand-rolled wildcard: * matches any sequence except /, ** matches any sequence
function wildcardMatch(pattern: string, subject: string): boolean { ... }
```

> Use hand-rolled wildcard matching to avoid adding a `minimatch` dependency. The pattern
> `*` matches anything except `/`. `**` matches anything including `/`. Sufficient for MVP.

**Verify:** Unit tests in `packages/core/src/__tests__/approval/engine.test.ts` — test
allow/deny/prompt results, last-match-wins, session cache.

---

### Task 2: Config schema — `permissions` array

**Files:** `packages/core/src/config/schema.ts`
**Decisions:** D027, D032

```typescript
// Inside DiligentConfigSchema .object({ ... })
permissions: z
  .array(
    z.object({
      permission: z.enum(["read", "write", "execute"]),
      pattern: z.string(),
      action: z.enum(["allow", "deny", "prompt"]),
    })
  )
  .optional(),
```

**Verify:** `bun run typecheck` — `DiligentConfig["permissions"]` type resolves correctly.

---

### Task 3: Wire PermissionEngine into AgentLoopConfig + loop.ts

**Files:** `packages/core/src/agent/types.ts`, `packages/core/src/agent/loop.ts`
**Decisions:** D016, D028, D029, D070

Add callbacks to `AgentLoopConfig`:

```typescript
// agent/types.ts
import type { ApprovalRequest, ApprovalResponse, UserInputRequest, UserInputResponse } from "../tool/types";

export interface AgentLoopConfig {
  // ... existing fields ...
  /** D028: Called for each ctx.approve() — rule engine + optional UI callback */
  approve?: (request: ApprovalRequest) => Promise<ApprovalResponse>;
  /** D088: Called for each request_user_input tool execution */
  ask?: (request: UserInputRequest) => Promise<UserInputResponse>;
}
```

In `loop.ts`, replace the auto-approve stub and add denied tool filter:

```typescript
// loop.ts — before building LLM tool list (D070)
function filterAllowedTools(tools: Tool[], engine: PermissionEngine | undefined): Tool[] {
  if (!engine) return tools;
  return tools.filter((tool) => {
    const action = engine.evaluate({
      permission: toolPermission(tool.name), // "read"|"write"|"execute" based on tool
      toolName: tool.name,
      description: tool.description,
    });
    return action !== "deny"; // denied tools removed from LLM list
  });
}

// In runLoop, before passing tools to streamAssistantResponse:
const activeTools = filterAllowedTools(modeTools, config.permissionEngine);

// In ToolContext construction:
const ctx: ToolContext = {
  toolCallId: toolCall.id,
  signal: config.signal ?? new AbortController().signal,
  approve: async (request) => {
    if (config.approve) return config.approve(request);
    return "once"; // fallback: auto-approve when no handler provided
  },
  ask: config.ask ? (request) => config.ask!(request) : undefined,
  onUpdate: ...,
};
```

> Note: `config.permissionEngine` should be added to `AgentLoopConfig` as well, so
> `filterAllowedTools` can access it. Alternatively, `approve` itself can handle "deny"
> directly — prefer separate engine field to keep deny-before-send and prompt-during-call
> concerns distinct.

**Verify:** Existing tests still pass (auto-approve fallback keeps current behavior). New test:
`agentLoop` with a deny-rule engine omits denied tool from the LLM call.

---

### Task 4: `request_user_input` tool

**Files:** `packages/core/src/tools/request-user-input.ts`, `tool/types.ts`
**Decisions:** D088

First, add `UserInputRequest/Response` and `ask?` to `ToolContext`:

```typescript
// tool/types.ts
export interface UserInputQuestion {
  id: string;
  question: string;
  options?: string[];    // multiple-choice
  is_secret?: boolean;   // mask input
}

export interface UserInputRequest {
  questions: UserInputQuestion[];
}

export interface UserInputResponse {
  answers: Record<string, string>; // keyed by question id
}

export interface ToolContext {
  // ... existing fields ...
  ask?: (request: UserInputRequest) => Promise<UserInputResponse>;
}
```

Implement the tool:

```typescript
// tools/request-user-input.ts
import { z } from "zod";
import type { Tool } from "../tool/types";

const QuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  options: z.array(z.string()).optional(),
  is_secret: z.boolean().optional(),
});

const ParamsSchema = z.object({
  questions: z.array(QuestionSchema).min(1),
});

export const requestUserInputTool: Tool<typeof ParamsSchema> = {
  name: "request_user_input",
  description: "Ask the user one or more questions and wait for their responses. Use when you need clarification or a decision before proceeding.",
  parameters: ParamsSchema,
  async execute(args, ctx) {
    if (!ctx.ask) {
      return { output: "User input not available in this context." };
    }
    const response = await ctx.ask({ questions: args.questions });
    const lines = args.questions.map(
      (q) => `${q.question}\nAnswer: ${response.answers[q.id] ?? "(no answer)"}`
    );
    return { output: lines.join("\n\n") };
  },
};
```

Register in tool index and ensure it appears in all modes (no `allowedModes` restriction per D088).

**Verify:** Unit test — mock `ctx.ask`, verify tool returns formatted answer string.

---

### Task 5: `ApprovalDialog` TUI component

**Files:** `packages/cli/src/tui/components/approval-dialog.ts`
**Decisions:** D028, D029

A 3-button dialog (Once / Always / Reject) with keyboard shortcuts:

```typescript
export interface ApprovalDialogOptions {
  toolName: string;
  permission: "read" | "write" | "execute";
  description: string;
  details?: string; // e.g., command or file path
}

export class ApprovalDialog implements Component {
  private selectedIndex = 0; // 0=Once, 1=Always, 2=Reject

  constructor(
    private options: ApprovalDialogOptions,
    private onResult: (response: ApprovalResponse) => void,
  ) {}

  // Layout: title + description + [Once] [Always] [Reject]
  // Keys: ←/→ or o/a/r to select, Enter to confirm, Escape = Reject
  render(): string[] { ... }
  handleInput(key: string): boolean { ... }
}
```

Display format:
```
┌─ Permission Request ─────────────────────────────────┐
│ bash wants to execute a command                       │
│                                                       │
│   rm -rf dist/                                        │
│                                                       │
│ [Once]  [Always]  [Reject]                            │
└───────────────────────────────────────────────────────┘
```

Keyboard: `o` = Once, `a` = Always, `r`/`Esc` = Reject. Arrow keys to navigate buttons. Enter to confirm.

**Verify:** Component unit test — render snapshot, key event → correct `ApprovalResponse`.

---

### Task 6: Wire everything in app.ts

**Files:** `packages/cli/src/tui/app.ts`
**Decisions:** D028, D029, D088

Create `PermissionEngine` from config rules and provide `approve` + `ask` callbacks:

```typescript
// In App constructor or buildAgentConfig():
const permissionRules = config.diligent.permissions ?? [];
const permissionEngine = createPermissionEngine(permissionRules);

// approve callback — rule engine first, dialog only on "prompt"
const approve = async (request: ApprovalRequest): Promise<ApprovalResponse> => {
  const action = permissionEngine.evaluate(request);
  if (action === "allow") return "once";
  if (action === "deny") return "reject";
  // action === "prompt" — show dialog
  return this.showApprovalDialog(request);
};

// ask callback — show TextInput overlay
const ask = async (request: UserInputRequest): Promise<UserInputResponse> => {
  return this.showUserInputDialog(request);
};
```

`showApprovalDialog` shows `ApprovalDialog` overlay and resolves the promise on user response.
On `"always"`, calls `permissionEngine.remember(request, "allow")` before resolving.
On `"reject"` with cascading — current scope: just return "reject" to the calling tool (MVP; full cascading of all pending is a follow-up).

`showUserInputDialog` shows `TextInput` (or a new multi-question variant) overlay, resolves when submitted.

Pass callbacks into `AgentLoopConfig`:
```typescript
agentConfig = {
  ...existingConfig,
  approve,
  ask,
  permissionEngine, // for denied-tool filter in loop.ts
};
```

**Verify:** Manual: run diligent, let it call bash, confirm dialog appears and blocks loop.
Test: mock overlay callbacks in app unit test.

---

## Migration Notes

- `loop.ts:156` — `approve: async () => "once" as const` → replaced by `approve: async (req) => config.approve ? config.approve(req) : "once"`
- BACKLOG.md L4 section — entries reference `ctx.ask()` (old name); update to `ctx.approve()` after this phase
- BACKLOG.md P1 `request_user_input tool` — remove "plan mode only" qualifier (now all modes per D088)

## Acceptance Criteria

1. `bun test` — all existing tests pass
2. `bun run typecheck` — no type errors
3. `bun run lint` — no lint errors
4. Bash tool call with no config rules shows `ApprovalDialog`; pressing `[Once]` proceeds; pressing `[Reject]` cancels the tool call with an error result
5. `permissions: [{ permission: "execute", pattern: "*", action: "allow" }]` in config → bash calls never show dialog
6. `permissions: [{ permission: "execute", pattern: "*", action: "deny" }]` → bash not in LLM tool list
7. Responding `[Always]` to a bash call → next bash call with same subject auto-approves without dialog
8. `request_user_input` tool shows `TextInput` overlay; user's answer is returned to LLM
9. `request_user_input` is available in `default`, `plan`, and `execute` modes

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | `PermissionEngine.evaluate()` — rule matching, last-match-wins | `engine.test.ts` |
| Unit | `PermissionEngine.remember()` — session cache overrides config rule | `engine.test.ts` |
| Unit | Wildcard matching — `*`, `**`, exact, no-match | `engine.test.ts` |
| Unit | `requestUserInputTool.execute()` with mock `ctx.ask` | `request-user-input.test.ts` |
| Unit | `ApprovalDialog` — render, key events → correct `ApprovalResponse` | `approval-dialog.test.ts` |
| Unit | `agentLoop` with deny-rule engine — denied tool absent from provider call | `loop.test.ts` |
| Integration | Full loop: approve callback wired, tool calls `ctx.approve()`, callback invoked | mock callback |
| Manual | `diligent` bash call → dialog appears and blocks; approval resumes | CLI run |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Loop blocking while dialog is shown — agent loop must not timeout or retry | Tool call hangs forever if dialog dismissed without response | Ensure `AbortSignal` propagates to `ctx.approve()`; on abort resolve with `"reject"` |
| `filterAllowedTools` runs on every turn — deny rules must be stable | Tool list changes mid-session if session rules grow | Only deny from config rules in `filterAllowedTools`; session-cache rules only affect `evaluate()` |
| `TextInput` overlay for `request_user_input` vs `InputEditor` (main input) — input focus conflict | Both try to consume stdin simultaneously | Ensure `overlayStack` focus properly transfers to overlay and back |
| Multi-question `request_user_input` (codex-rs supports batch) — single `TextInput` only shows one at a time | Multiple questions require multiple dialogs | MVP: iterate questions sequentially; batch UI is post-MVP |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D016 | `ToolContext.approve` hook placeholder | loop.ts wiring |
| D027 | Rule-based permission matching (`allow/deny/prompt`, last-match-wins) | `PermissionEngine` |
| D028 | `ctx.approve()` is a security boundary only | `ToolContext`, loop.ts |
| D029 | once/always/reject with session-scoped caching | `PermissionEngine.remember()`, ApprovalDialog |
| D070 | Denied tools removed from LLM tool list | `filterAllowedTools` in loop.ts |
| D086 | `ApprovalRequest/Response` types (already defined) | `tool/types.ts` |
| D088 | `request_user_input` — separate tool for user clarification, all modes | `request-user-input.ts`, app.ts |

## What This Phase Does NOT Include

- OS-level sandboxing (macOS seatbelt, Linux seccomp) — deferred post-MVP (D030)
- Doom loop detection integration with approval (D031) — separate backlog item
- Cascading "reject" canceling all session-pending approvals (D029 full spec) — MVP: single-request reject only
- Persistent permission rules (written back to `diligent.jsonc`) — session-scoped only at MVP
- Multi-question dialog for `request_user_input` — sequential single-input only at MVP
- Plan mode bash allowlist/denylist (D087a) — separate backlog item
- MCP tools through permission system — comes with L9 phase
