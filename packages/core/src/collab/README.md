# collab

Non-blocking multi-agent collaboration tools (codex-rs style).

Provides four tools — `spawn_agent`, `wait`, `send_input`, `close_agent` — that let a parent agent orchestrate multiple sub-agents running in parallel without blocking the agent loop.

## Architecture

```
spawn_agent  →  AgentRegistry.spawn()  →  background Promise (immediate return)
wait         →  AgentRegistry.wait()   →  Promise.race + timeout
send_input   →  AgentRegistry.sendInput() → SessionManager.steer()
close_agent  →  AgentRegistry.close()  →  abort + settle
```

`AgentRegistry` is the shared singleton created by `createCollabTools()` in `factory.ts`. All four tools share one registry instance.

## Key files

- `types.ts` — `AgentStatus`, `AgentEntry`, `CollabToolDeps`
- `nicknames.ts` — 87-name plant/tree pool (`NicknamePool`)
- `registry.ts` — `AgentRegistry` with `COLLAB_TOOL_NAMES`
- `factory.ts` — `createCollabTools(deps)` → `{ tools, registry }`
- `spawn-agent.ts`, `wait.ts`, `send-input.ts`, `close-agent.ts` — individual tool implementations
- `index.ts` — all re-exports
