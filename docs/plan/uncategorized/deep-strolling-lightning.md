---
id: P049
title: Introduce Agent class — separate stable config from per-run execution
type: refactor
status: draft
---

## Context

`DiligentAppServerConfig.buildAgentConfig` is called on **every turn**, rebuilding tools, systemPrompt, and model config from scratch each time. `AgentLoopConfig` mixes stable configuration (model, tools, systemPrompt, streamFunction, effort) with per-turn execution state (signal, sessionId, steering hooks, debug IDs). There is no "Agent" object — only a flat config bag passed to `runLoop`.

This refactor introduces `Agent` as a first-class object in `packages/core` that holds stable config and exposes `run(messages, opts)`. `DiligentAppServerConfig.buildAgentConfig` becomes `createAgent`, called once per thread context (not every turn). Per-turn state moves into `AgentRunOptions` injected at invocation time.

## Current State (after P048)

- `AgentLoopConfig` — flat bag of stable + per-turn fields, accepted by `agentLoop()`
- `DiligentAppServerConfig.buildAgentConfig(args)` — called every turn, receives `signal`, `approve`, `ask`, `existingRegistry`, returns `AgentLoopConfig & { registry? }`
- `ThreadRuntime.registry` — holds `AgentRegistry` between turns
- `SessionManagerConfig.agentConfig` — `AgentLoopConfig | (() => AgentLoopConfig)` factory
- `SessionManager.runSession()` — own multi-turn loop (compaction, persistence, steering); does NOT call `agentLoop()`, calls `streamAssistantResponse()` / `executeToolCalls()` directly

## Type Split

### `AgentConfig` — stable, built once per thread context

```ts
// packages/core/src/agent/types.ts
export interface AgentConfig {
  model: Model;
  systemPrompt: SystemSection[];
  tools: Tool[];
  streamFunction: StreamFunction;
  effort: ThinkingEffort;
  maxTurns?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  filterTool?: (tool: Tool) => boolean;
}
```

### `AgentRunOptions` — per-invocation, injected by SessionManager

```ts
export interface AgentRunOptions {
  signal?: AbortSignal;
  sessionId?: string;
  reservePercent?: number;
  debugThreadId?: string;
  debugTurnId?: string;
  getSteeringMessages?: () => Message[];
  hasPendingMessages?: () => boolean;
}

// Backward-compat alias — loop.ts continues to use this internally
export type AgentLoopConfig = AgentConfig & AgentRunOptions;
```

## New Objects

### `Agent` — core (packages/core/src/agent/agent.ts)

```ts
export class Agent {
  constructor(readonly config: AgentConfig) {}

  run(messages: Message[], opts: AgentRunOptions = {}): EventStream<CoreAgentEvent, Message[]> {
    return agentLoop(messages, { ...this.config, ...opts });
  }
}
```

Used directly for standalone execution (tests, sub-agents that don't need session persistence).

### `RuntimeAgent` — runtime (packages/runtime/src/app-server/runtime-agent.ts)

Carries the collab registry alongside the agent config:

```ts
export class RuntimeAgent extends Agent {
  constructor(config: AgentConfig, public readonly registry?: AgentRegistry) {
    super(config);
  }
}
```

## DiligentAppServerConfig: `buildAgentConfig` → `createAgent`

```ts
// packages/runtime/src/app-server/server.ts

export interface CreateAgentArgs {
  cwd: string;
  mode: ModeKind;
  effort: ThinkingEffort;
  modelId?: string;
  approve: (req: ApprovalRequest) => Promise<ApprovalResponse>;  // baked into tool closures
  ask: (req: UserInputRequest) => Promise<UserInputResponse>;    // baked into tool closures
  existingAgent?: RuntimeAgent;   // carry over registry
}

// In DiligentAppServerConfig:
createAgent: (args: CreateAgentArgs) => RuntimeAgent | Promise<RuntimeAgent>;
```

**Removed from args**: `signal` (per-run), `getSessionId` (unused after refactor), `onCollabEvent` (wired per-turn via `registry.setCollabEventHandler()`).

### `createAgent` called only on config context change

`ThreadRuntime.registry?: AgentRegistry` → `ThreadRuntime.agent?: RuntimeAgent`

Before each turn:
```ts
// Only rebuild if mode/effort/model changed since last agent was created
if (!runtime.agent || hasConfigChanged(runtime)) {
  runtime.agent = await this.config.createAgent({
    cwd, mode, effort, modelId, approve, ask,
    existingAgent: runtime.agent,   // preserves registry
  });
}
runtime.agent.registry?.setCollabEventHandler(onCollabEventHandler);
```

`hasConfigChanged` compares `runtime.{mode, effort, modelId}` against a stored snapshot on the agent.

Config-changing RPC handlers (`handleModeSet`, `handleEffortSet`, `CONFIG_SET` model change) set `runtime.agent = undefined` to force a rebuild on the next turn.

## SessionManager Changes

### `SessionManagerConfig.agentConfig` → `agent`

```ts
interface SessionManagerConfig {
  agent: Agent | (() => Agent | Promise<Agent>);   // was: agentConfig
  // ... rest unchanged
}
```

### `run()` gains signal + debug opts

```ts
// was: run(userMessage: Message): EventStream<...>
run(
  userMessage: Message,
  opts?: { signal?: AbortSignal; debugThreadId?: string; debugTurnId?: string }
): EventStream<AgentEvent, Message[]>
```

Signal threading currently happens via the `agentConfig` factory closure. After the refactor it becomes explicit in the `run()` call.

### Per-turn config assembly in `runSession()`

```ts
// was: const fullConfig = { ...rawAgentConfig, sessionId, reservePercent, ... }
// now:
const agent = await this.resolveAgent();
const loopConfig: AgentLoopConfig = {
  ...agent.config,
  signal: this.currentSignal,
  sessionId: this.writer.id,
  reservePercent: ...,
  getSteeringMessages: ...,
  hasPendingMessages: ...,
  debugThreadId: ...,
  debugTurnId: ...,
};
// passed to createTurnRuntime / streamAssistantResponse / executeToolCalls
```

`SessionManager` still runs its own loop — it does not call `agent.run()`.

## Collab Registry: child agents use `agent` factory

```ts
// packages/runtime/src/collab/registry.ts — spawn()
factory({
  agent: async () => {         // was: agentConfig
    const result = await buildDefaultTools(...);
    return new RuntimeAgent({ model, effort, systemPrompt, tools, streamFunction, maxTurns }, result.registry);
  },
  // signal no longer in SessionManagerConfig — passed to childManager.run()
});

// ...later in background promise:
const stream = childManager.run(userMessage, { signal: abortController.signal });
```

## Tasks

### T1 — `packages/core/src/agent/types.ts`
Add `AgentConfig`, `AgentRunOptions`. Make `AgentLoopConfig = AgentConfig & AgentRunOptions`.

### T2 — `packages/core/src/agent/agent.ts` (new)
`Agent` class with `config: AgentConfig` and `run(messages, opts)`.

### T3 — `packages/core/src/agent/index.ts` + `packages/core/src/index.ts`
Export `AgentConfig`, `AgentRunOptions`, `Agent`.

### T4 — `packages/runtime/src/app-server/runtime-agent.ts` (new)
`RuntimeAgent extends Agent` with `registry?: AgentRegistry`.

### T5 — `packages/runtime/src/app-server/server.ts`
- `DiligentAppServerConfig.buildAgentConfig` → `createAgent: (args: CreateAgentArgs) => RuntimeAgent | Promise<RuntimeAgent>`
- Export `CreateAgentArgs` interface
- `ThreadRuntime.registry?: AgentRegistry` → `agent?: RuntimeAgent`
- All `runtime.registry` references → `runtime.agent?.registry`
- `consumeStream`: collab event wiring uses `runtime.agent?.registry`

### T6 — `packages/runtime/src/app-server/thread-handlers.ts`
- Replace `runtime.registry` with `runtime.agent`
- `hasConfigChanged(runtime)` helper comparing effort/modelId/mode snapshot vs current
- Call `createAgent` lazily before each turn, invalidate on config-change handlers
- Pass `signal`, `debugThreadId`, `debugTurnId` to `manager.run()`

### T7 — `packages/runtime/src/app-server/factory.ts`
Rename `buildAgentConfig` implementation to `createAgent`:
- Return `new RuntimeAgent(agentConfig, resultWithSkills.registry)` instead of flat object
- Remove `signal`, `permissionEngine` from return (signal is per-run; permissionEngine is baked into tool closures)

### T8 — `packages/runtime/src/session/manager.ts`
- `SessionManagerConfig.agentConfig` → `agent: Agent | (() => Agent | Promise<Agent>)`
- `resolveAgentConfig()` → `resolveAgent(): Agent | Promise<Agent>`
- `run()` signature: add `opts?: { signal?, debugThreadId?, debugTurnId? }`
- `runSession()`: assemble `AgentLoopConfig` from `agent.config + runOpts`
- `performCompaction()`: use `agent.config.streamFunction` / `agent.config.model` instead of `agentConfig`

### T9 — `packages/runtime/src/collab/registry.ts`
- `agentConfig: async () => AgentLoopConfig` → `agent: async () => RuntimeAgent`
- `childManager.run(userMessage, { signal: abortController.signal })`

### T10 — `packages/runtime/src/index.ts`
Export `Agent`, `AgentConfig`, `AgentRunOptions`, `RuntimeAgent`, `CreateAgentArgs`.

### T11 — Fix tests
- `packages/e2e/helpers/server-factory.ts` — `buildAgentConfig` → `createAgent`
- `packages/cli/test/helpers/in-process-server.ts` — same
- `packages/runtime/src/session/__tests__/` — `agentConfig:` → `agent:`
- `packages/core/src/agent/__tests__/agent.test.ts` (new) — unit tests for `Agent.run()`

## Key Risks

| Risk | Mitigation |
|---|---|
| Signal not reaching tools | Signal flows via `AgentRunOptions.signal` → `AgentLoopConfig.signal` → `ToolContext.signal` in `executeToolCalls` — same path as before |
| Registry lost on agent rebuild | `existingAgent?.registry` passed to `buildDefaultTools` as `existingRegistry`, same as current `existingRegistry` pattern |
| `compactNow()` needs `streamFunction` | `performCompaction` uses `agent.config.streamFunction`; `compactNow()` calls `resolveAgent()` to get current agent |
| `SessionManager` factory called per-turn | Factory `() => Agent` is still supported; for test servers that don't cache, behavior is unchanged |

## Verification

```bash
bun run typecheck   # 0 errors
bun test            # all pass
```

Critical e2e coverage: `turn-execution.test.ts` (abort signal), `conversation.test.ts` (basic turns), collab integration tests (spawn/wait registry preservation).
