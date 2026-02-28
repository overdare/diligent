# Core

Agent loop, providers, tools, config, sessions, and knowledge — the engine of Diligent.

```
src/
  agent/           Agent loop and loop detector
  config/          Config loading, schema, and instructions
  infrastructure/  Diligent directory resolution
  knowledge/       Knowledge store, injection, and ranking
  prompt/          System prompt construction
  provider/        LLM providers (Anthropic, OpenAI) and retry logic
  session/         Session management, compaction, persistence
  skills/          Skill discovery, rendering, and frontmatter parsing
  tool/            Tool executor, registry, and truncation
  tools/           Built-in tool implementations (bash, edit, glob, grep, read, write, ls)
  event-stream.ts  Event stream types
  types.ts         Shared core types
test/              Unit tests
```
