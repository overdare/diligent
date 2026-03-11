# @diligent/core

The engine. Agent loop, provider abstraction, tool system, session management, and all agent logic lives here.

Tests are primarily under `test/` for package-level behavior, with a small number of focused colocated tests in `src/**/__tests__/`.

## Structure

```
src/
  agent/          Agent loop, loop detection, agent types
  app-server/     DiligentAppServer — the single RPC entry point
  approval/       Permission engine and approval matching
  auth/           API key + OAuth token lifecycle
  collab/         Multi-agent collaboration tools (spawn_agent, wait, send_input, close_agent)
  config/         3-layer JSONC config loading
  infrastructure/ Project-local .diligent path resolution and setup
  knowledge/      JSONL knowledge store + system prompt injection
  prompt/         System prompt construction
  provider/       Anthropic, OpenAI, ChatGPT OAuth, Gemini providers
  rpc/            Transport-neutral JSON-RPC helpers
  session/        JSONL session persistence, compaction, steering
  skills/         Skill discovery + frontmatter + system prompt injection
  tool/           Tool interface + execution harness
  tools/          Built-in tools, provider-specific file editing variants, and plugin loading
```

## Key Patterns

- **AgentLoop** — stateless function over `TurnContext` + `SessionState`
- **EventStream** — async iterable for streaming LLM events (~86 lines)
- **TurnContext** — immutable per-turn config; `SessionState` holds mutable state
- **Provider** — common `StreamFunction` interface, dispatched by model prefix
- **Tool** — `{ name, description, parameters (Zod), execute(args, ctx) }`, one file per tool

## Tool assembly

- `buildDefaultTools()` assembles the baseline built-ins and then applies config/plugin resolution.
- File-editing tools are provider-dependent:
  - OpenAI models use `apply_patch`
  - Other providers use `write` + `edit` + `multi_edit`
- `add_knowledge` is included when project paths are available.
- Collaboration tools are added separately and are not user-configurable.

## collab — Multi-Agent Tools

Four tools that let a parent agent orchestrate sub-agents in parallel without blocking the loop:

```
spawn_agent  →  AgentRegistry.spawn()      background Promise (immediate return)
wait         →  AgentRegistry.wait()       Promise.race + timeout
send_input   →  AgentRegistry.sendInput()  SessionManager.steer()
close_agent  →  AgentRegistry.close()      abort + settle
```

`AgentRegistry` is a shared singleton created by `createCollabTools()`. All four tools share one registry instance. Nicknames are drawn from an 87-name plant/tree pool.

## provider — LLM Providers

| File | Purpose |
|---|---|
| `anthropic.ts` | Claude with streaming and tool use |
| `openai.ts` | OpenAI Responses API with streaming |
| `openai-shared.ts` | Shared message conversion and event loop |
| `chatgpt.ts` | ChatGPT subscription via raw fetch + OAuth |
| `gemini.ts` | Google Gemini with streaming |
| `provider-manager.ts` | Dispatch by model prefix, auth lifecycle |
| `models.ts` | Known model definitions and alias resolver |
| `retry.ts` | Exponential backoff wrapper |
