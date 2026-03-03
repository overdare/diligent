---
id: P019
status: done
created: 2026-03-03
---

# Approval Pattern Support & "Always" Bug Fix

## Context

Two related problems in the approval system:

1. **"Always" does nothing in Web UI**: `remember()` is only called from TUI's `handleApprove()`. The Web frontend's approval flow goes through `app-server/server.ts → requestApproval()` which just proxies the decision — `remember()` is never invoked. So clicking "always" in the web UI has no effect.

2. **Patterns too narrow**: Even in TUI where `remember()` works, it stores the exact command/path (e.g., `"npm test"`), so any slight variation (e.g., `"npm run build"`) triggers a new prompt. This makes "always" nearly useless.

**Additional bug**: Subject extraction uses `details?.path` but write/edit tools pass `details.file_path`. Write/edit subjects fall through to `toolName` ("write"/"edit"), making config path patterns (e.g., `src/**`) ineffective for write/edit.

## Approach

Move evaluate/remember logic from TUI into the **agent loop** — the single place where both `permissionEngine` and `approve` callback live. This fixes Web+TUI simultaneously. Add `generatePattern()` for wildcard auto-generation on "always".

## Changes

### 1. `packages/core/src/approval/engine.ts`

**Add `extractSubject()`** — shared helper fixing the `file_path` bug:
```typescript
export function extractSubject(request: ApprovalRequest): string {
  const d = request.details;
  const raw = d?.file_path ?? d?.path ?? d?.command ?? request.toolName;
  return String(raw);
}
```

**Add `generatePattern()`** — exported pure function:
- Commands (`details.command`): first word + ` **` → `npm test` becomes `npm **`
- File paths (`details.file_path` or `details.path`): parent dir + `/**` → `/a/b/c.ts` becomes `/a/b/**`
- Fallback: exact `toolName`

**Update `evaluate()`** and **`remember()`** to use `extractSubject()` and `generatePattern()`.

### 2. `packages/core/src/agent/loop.ts` (lines 188-191)

Wrap `ctx.approve` with evaluate/remember:
```typescript
approve: async (request) => {
  // Consult permission engine first
  if (config.permissionEngine) {
    const action = config.permissionEngine.evaluate(request);
    if (action === "allow") return "once";
    if (action === "deny") return "reject";
  }
  // Fall through to UI prompt
  if (!config.approve) return "once";
  const response = await config.approve(request);
  // "always" → store session rule
  if (response === "always" && config.permissionEngine) {
    config.permissionEngine.remember(request, "allow");
  }
  return response;
},
```

### 3. `packages/cli/src/tui/app.ts`

**Simplify `handleApprove()`** (line 660-670) — remove evaluate/remember, keep only dialog:
```typescript
private async handleApprove(request: ApprovalRequest): Promise<ApprovalResponse> {
  return this.showApprovalDialog(request);
}
```

Note: yolo mode check stays at line 568 (`handleServerRequest`).

**Fix `showApprovalDialog()`** (line 689-693) — add `file_path` to details display:
```typescript
details: request.details?.command
  ? String(request.details.command)
  : (request.details?.file_path ?? request.details?.path)
    ? String(request.details.file_path ?? request.details.path)
    : undefined,
```

### 4. `packages/core/src/approval/__tests__/engine.test.ts`

- Add `describe("extractSubject")` — test file_path > path > command > toolName priority
- Add `describe("generatePattern")` — test command/path/toolName cases
- Update `describe("PermissionEngine.remember")` — verify wildcard patterns match broader subjects
- Add test for file_path-based evaluate (write/edit tools)

### 5. `packages/core/src/approval/index.ts`

Export new functions:
```typescript
export { createPermissionEngine, extractSubject, generatePattern } from "./engine";
```

## Verification

```bash
# Run approval engine tests
bun test packages/core/src/approval/__tests__/engine.test.ts

# Run agent loop tests (if any affected)
bun test packages/core/test/

# Manual: start TUI, trigger a bash command, click "always", run a different command with same prefix — should auto-approve
# Manual: start Web, do the same — should now also work
```
