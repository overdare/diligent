# @diligent/core

The engine. Agent loop, provider abstraction, tool system, session management, and all agent logic lives here.

## Structure

```
src/
  agent/          Agent loop, loop detection, agent types
  app-server/     DiligentAppServer — the single RPC entry point
  approval/       Approval hook (stub)
  auth/           API key + OAuth token lifecycle
  collab/         Multi-agent collaboration tools (spawn_agent, wait, send_input, close_agent)
  config/         3-layer JSONC config loading
  infrastructure/ EventStream, utilities
  knowledge/      JSONL knowledge store + system prompt injection
  prompt/         System prompt construction
  provider/       Anthropic, OpenAI, ChatGPT OAuth, Gemini providers
  rpc/            Transport-neutral JSON-RPC helpers
  session/        JSONL session persistence, compaction, steering
  skills/         Skill discovery + frontmatter + system prompt injection
  tool/           Tool interface + execution harness
  tools/          10 built-in tools (bash, read, write, apply_patch, glob, grep, ls, plan, add_knowledge, request_user_input)
```

## Key Patterns

- **AgentLoop** — stateless function over `TurnContext` + `SessionState`
- **EventStream** — async iterable for streaming LLM events (~86 lines)
- **TurnContext** — immutable per-turn config; `SessionState` holds mutable state
- **Provider** — common `StreamFunction` interface, dispatched by model prefix
- **Tool** — `{ name, description, parameters (Zod), execute(args, ctx) }`, one file per tool

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
