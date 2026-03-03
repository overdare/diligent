---
id: P017
status: done
created: 2026-03-03
---

# Sub-agent session distinction

## Goal

Sub-agent sessions are marked with `parentSession` in their JSONL header, and `thread/list` excludes them by default so the UI only shows user-initiated conversations.

## Prerequisites

- Collab layer (D062-D065) with `AgentRegistry` and `SessionManager` child creation
- Session persistence layer with `parentSession` field in `SessionHeader` (already exists, never populated for sub-agents)

## Artifact

```
# Before: thread/list returns everything mixed together
[main-session-1, subagent-session-A, subagent-session-B, main-session-2]

# After: thread/list returns only main sessions by default
[main-session-1, main-session-2]

# With includeChildren=true: returns all sessions with parentSession visible
[main-session-1, subagent-session-A (parent: main-session-1), ...]
```

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| packages/core/src/session | `DeferredWriter` accepts `parentSession`, `SessionManagerConfig` gains `parentSession`, `SessionInfo` exposes it, `listSessions` extracts it |
| packages/core/src/collab | `CollabToolDeps` gains `parentSessionId`, `AgentRegistry.spawn()` passes it to child `SessionManagerConfig` |
| packages/core/src/app-server | `buildAgentConfig` args gain `sessionId`, `handleThreadList` filters by `parentSession` |
| packages/protocol | `SessionSummarySchema` gains `parentSession`, `ThreadListParamsSchema` gains `includeChildren` |
| packages/web/src/server | `buildAgentConfig` callback passes `sessionId` as `parentSessionId` |
| packages/cli/src/tui | Same as web |

### What does NOT change

- SESSION_VERSION unchanged (populating existing optional field, not adding schema)
- No `role` field on `SessionHeader` (`parentSession` presence is sufficient to distinguish)
- No frontend UI changes (sidebar already works, just sees fewer sessions)
- No changes to session resume, branching, or compaction logic

## File Manifest

### packages/core/src/session/

| File | Action | Description |
|------|--------|------------|
| `types.ts` | MODIFY | Add `parentSession?: string` to `SessionInfo` |
| `persistence.ts` | MODIFY | `DeferredWriter` accepts `parentSession` param, passes to `createSessionFile`; `listSessions` extracts `parentSession` from header |
| `manager.ts` | MODIFY | `SessionManagerConfig` gains `parentSession`; constructor and `create()` pass it to `DeferredWriter`; add `sessionId` getter |

### packages/core/src/collab/

| File | Action | Description |
|------|--------|------------|
| `types.ts` | MODIFY | Add `parentSessionId?: string` to `CollabToolDeps` |
| `registry.ts` | MODIFY | `spawn()` passes `this.deps.parentSessionId` as `parentSession` to child config |

### packages/core/src/app-server/

| File | Action | Description |
|------|--------|------------|
| `server.ts` | MODIFY | Add `sessionId` to `buildAgentConfig` args; `handleThreadList` filters + accepts `includeChildren`; dispatch passes new param |

### packages/protocol/src/

| File | Action | Description |
|------|--------|------------|
| `data-model.ts` | MODIFY | Add `parentSession` to `SessionSummarySchema` |
| `client-requests.ts` | MODIFY | Add `includeChildren` to `ThreadListParamsSchema` |

### packages/web/src/server/

| File | Action | Description |
|------|--------|------------|
| `index.ts` | MODIFY | Pass `sessionId` as `parentSessionId` in collabDeps |

### packages/cli/src/tui/

| File | Action | Description |
|------|--------|------------|
| `runner.ts` | MODIFY | Pass `sessionId` as `parentSessionId` in deps |
| `app.ts` | MODIFY | Pass `sessionId` as `parentSessionId` in deps |

### packages/core/test/

| File | Action | Description |
|------|--------|------------|
| `session-persistence.test.ts` | MODIFY | Add tests for `DeferredWriter` with parentSession and `listSessions` parentSession extraction |
| `collab/helpers.ts` | MODIFY | Add `sessionId` getter to mock SessionManager |
| `collab/registry.test.ts` | MODIFY | Add test verifying parentSessionId flows to child config |

## Implementation Tasks

### Task 1: Thread `parentSession` through persistence layer

**Files:** `packages/core/src/session/types.ts`, `packages/core/src/session/persistence.ts`, `packages/core/src/session/manager.ts`

Add `parentSession` to `SessionInfo`:

```typescript
// types.ts — SessionInfo
export interface SessionInfo {
  // ... existing fields ...
  parentSession?: string;  // NEW
}
```

Add `parentSession` param to `DeferredWriter`:

```typescript
// persistence.ts — DeferredWriter constructor
constructor(
  private sessionsDir: string,
  private cwd: string,
  existingPath?: string,
  private parentSession?: string,  // NEW
)
```

Pass it through in `flush()`:

```typescript
// persistence.ts — DeferredWriter.flush()
const { path } = await createSessionFile(this.sessionsDir, this.cwd, this.parentSession);
```

Extract in `listSessions()`:

```typescript
// persistence.ts — listSessions, inside the push
sessions.push({
  // ... existing fields ...
  parentSession: header.parentSession,  // NEW
});
```

Add `parentSession` to `SessionManagerConfig` and thread it:

```typescript
// manager.ts — SessionManagerConfig
export interface SessionManagerConfig {
  // ... existing fields ...
  parentSession?: string;  // NEW
}

// manager.ts — constructor
constructor(private config: SessionManagerConfig) {
  this.writer = new DeferredWriter(
    config.paths.sessions, config.cwd,
    undefined,             // existingPath
    config.parentSession,  // NEW
  );
}

// manager.ts — create()
async create(): Promise<void> {
  // ... existing reset ...
  this.writer = new DeferredWriter(
    this.config.paths.sessions, this.config.cwd,
    undefined,                    // existingPath
    this.config.parentSession,    // NEW
  );
}
```

Add `sessionId` getter to `SessionManager`:

```typescript
// manager.ts — after existing sessionPath getter
get sessionId(): string | null {
  const p = this.writer.path;
  if (!p) return null;
  const filename = p.split("/").pop();
  return filename ? filename.replace(".jsonl", "") : null;
}
```

**Verify:** `bun test session-persistence` — existing tests pass + new parentSession tests pass.

### Task 2: Thread `parentSessionId` through collab layer

**Files:** `packages/core/src/collab/types.ts`, `packages/core/src/collab/registry.ts`

```typescript
// types.ts — CollabToolDeps
export interface CollabToolDeps {
  // ... existing fields ...
  parentSessionId?: string;  // NEW
}

// registry.ts — spawn(), in the factory call (line ~58-70)
const childManager = factory({
  cwd: this.deps.cwd,
  paths: this.deps.paths,
  agentConfig: { /* ... existing ... */ },
  compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
  parentSession: this.deps.parentSessionId,  // NEW
});
```

**Verify:** `bun test collab` — existing tests pass (parentSessionId is optional).

### Task 3: Thread `sessionId` through AppServer

**Files:** `packages/core/src/app-server/server.ts`

Add `sessionId` to `buildAgentConfig` callback args:

```typescript
// server.ts — DiligentAppServerConfig.buildAgentConfig args
buildAgentConfig: (args: {
  cwd: string;
  mode: Mode;
  signal: AbortSignal;
  approve: (request: ApprovalRequest) => Promise<ApprovalResponse>;
  ask: (request: UserInputRequest) => Promise<UserInputResponse>;
  sessionId?: string;  // NEW
}) => AgentLoopConfig;
```

Pass it in `createThreadRuntime()`:

```typescript
// server.ts — createThreadRuntime, inside agentConfig factory
agentConfig: () => {
  const signal = runtime.abortController?.signal ?? new AbortController().signal;
  return this.config.buildAgentConfig({
    cwd,
    mode: runtime.mode,
    signal,
    approve: (request) => this.requestApproval(runtime.id, request),
    ask: (request) => this.requestUserInput(runtime.id, request),
    sessionId: runtime.manager.sessionId ?? undefined,  // NEW
  });
},
```

**Verify:** TypeScript compiles without errors.

### Task 4: Update protocol schemas

**Files:** `packages/protocol/src/data-model.ts`, `packages/protocol/src/client-requests.ts`

```typescript
// data-model.ts — SessionSummarySchema
export const SessionSummarySchema = z.object({
  // ... existing fields ...
  parentSession: z.string().optional(),  // NEW
});

// client-requests.ts — ThreadListParamsSchema
export const ThreadListParamsSchema = z.object({
  limit: z.number().int().positive().max(500).optional(),
  includeChildren: z.boolean().optional(),  // NEW
});
```

**Verify:** `bun test` in protocol package (if tests exist), otherwise TypeScript compilation.

### Task 5: Filter in `handleThreadList` and map `parentSession`

**Files:** `packages/core/src/app-server/server.ts`

Update dispatch:

```typescript
// server.ts — dispatchClientRequest
case DILIGENT_CLIENT_REQUEST_METHODS.THREAD_LIST:
  return this.handleThreadList(request.params.limit, request.params.includeChildren);
```

Update handler:

```typescript
private async handleThreadList(
  limit?: number,
  includeChildren?: boolean,
): Promise<{ data: SessionSummary[] }> {
  const all = [] as SessionSummary[];

  for (const cwd of this.knownCwds) {
    const paths = await this.config.resolvePaths(cwd);
    const sessions = await listSessions(paths.sessions);
    all.push(
      ...sessions.map((session) => ({
        id: session.id,
        path: session.path,
        cwd: session.cwd,
        name: session.name,
        created: session.created.toISOString(),
        modified: session.modified.toISOString(),
        messageCount: session.messageCount,
        firstUserMessage: session.firstUserMessage,
        parentSession: session.parentSession,  // NEW
      })),
    );
  }

  const deduped = new Map<string, SessionSummary>();
  for (const entry of all) deduped.set(entry.id, entry);

  let result = Array.from(deduped.values());

  // Filter out sub-agent sessions by default
  if (!includeChildren) {
    result = result.filter((s) => !s.parentSession);
  }

  return { data: result.slice(0, limit ?? 100) };
}
```

**Verify:** Manual test — spawn subagent, verify `thread/list` hides its session.

### Task 6: Wire callers (Web + CLI)

**Files:** `packages/web/src/server/index.ts`, `packages/cli/src/tui/runner.ts`, `packages/cli/src/tui/app.ts`

All three callers follow the same pattern — destructure `sessionId` from args and include `parentSessionId` in deps:

```typescript
// Each buildAgentConfig callback:
buildAgentConfig: ({ cwd: requestCwd, mode, signal, approve, ask, sessionId }) => {
  const deps = {
    model: ...,
    systemPrompt: ...,
    streamFunction: ...,
    parentSessionId: sessionId,  // NEW
  };
  // ... rest unchanged ...
},
```

**Verify:** `bun run build` — no type errors across packages.

### Task 7: Tests

**Files:** `packages/core/test/session-persistence.test.ts`, `packages/core/test/collab/helpers.ts`, `packages/core/test/collab/registry.test.ts`

Persistence tests:

```typescript
// session-persistence.test.ts
describe("listSessions parentSession", () => {
  it("includes parentSession when set in header", async () => {
    const dir = await setupDir();
    const { path } = await createSessionFile(dir, "/project", "parent-123");
    await appendEntry(path, makeUserEntry());
    const sessions = await listSessions(dir);
    expect(sessions[0].parentSession).toBe("parent-123");
  });

  it("parentSession is undefined for top-level sessions", async () => {
    const dir = await setupDir();
    const { path } = await createSessionFile(dir, "/project");
    await appendEntry(path, makeUserEntry());
    const sessions = await listSessions(dir);
    expect(sessions[0].parentSession).toBeUndefined();
  });
});

describe("DeferredWriter with parentSession", () => {
  it("passes parentSession to session header on flush", async () => {
    const dir = await setupDir();
    const writer = new DeferredWriter(dir, "/project", undefined, "parent-abc");
    const userEntry = makeUserEntry();
    await writer.write(userEntry);
    await writer.write(makeAssistantEntry(userEntry.id));
    const { header } = await readSessionFile(writer.path!);
    expect(header.parentSession).toBe("parent-abc");
  });
});
```

Collab mock update:

```typescript
// collab/helpers.ts — add sessionId getter to mock
get sessionId(): string | null { return null; },
```

Registry test:

```typescript
// collab/registry.test.ts
it("spawn passes parentSessionId to child SessionManager config", () => {
  let capturedConfig: SessionManagerConfig | undefined;
  const registry = new AgentRegistry(
    makeCollabDeps({
      parentSessionId: "parent-xyz",
      sessionManagerFactory: (config) => {
        capturedConfig = config;
        return makeMockSessionManagerFactory(makeAssistant("ok"))(config);
      },
    }),
  );
  registry.spawn({ prompt: "test", description: "", agentType: "general" });
  expect(capturedConfig?.parentSession).toBe("parent-xyz");
});
```

**Verify:** `bun test` — all tests pass.

## Acceptance Criteria

1. `bun test` — all existing and new tests pass
2. Sub-agent sessions have `parentSession` set in their JSONL header
3. `thread/list` returns only main sessions by default
4. `thread/list` with `includeChildren: true` returns all sessions including sub-agents
5. `SessionSummary` includes `parentSession` field in protocol
6. No `any` type escape hatches in new code
7. Backward compatible — existing sessions without `parentSession` still appear in thread list

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | DeferredWriter parentSession passthrough | `bun test session-persistence` |
| Unit | listSessions extracts parentSession | `bun test session-persistence` |
| Unit | AgentRegistry passes parentSessionId to child config | `bun test collab` |
| Integration | thread/list filtering | Manual: start session, spawn subagent, verify list |
| Manual | Existing sessions still appear | Run against existing `.diligent/sessions/` directory |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| DeferredWriter 4th positional param fragile | Callers might pass wrong arg order | Only 2 call sites (constructor + create), both in SessionManager |
| Parent sessionId null before first flush | spawn_agent during first turn before DeferredWriter flushes | DeferredWriter flushes on first assistant message, which happens before tool execution |
| Backward compatibility of protocol schema | Old clients don't send `includeChildren` | `.optional()` — defaults to undefined which triggers the filter |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D062 | Multi-agent — child sessions use existing session system | Task 2: collab layer threading |
| D065 | Sub-agent result format includes session ID for resumption | Task 1: sessionId getter enables resume |
