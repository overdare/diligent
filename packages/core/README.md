# Core

Agent loop, providers, tools, config, sessions, and knowledge — the engine of Diligent.

## Navigation

```
src/
  app-server/     JSON-RPC app server built on core runtime
  agent/           Agent loop and loop detector
  approval/        Permission engine — rule matching, session cache
  auth/            Authentication and API key management
  collab/          Multi-agent collaboration tools (spawn, wait, send_input, close_agent)
  config/          Config loading, schema, and instructions
  infrastructure/  Diligent directory resolution
  knowledge/       Knowledge store, injection, and ranking
  prompt/          System prompt construction
  provider/        LLM providers and retry logic
  session/         Session management, compaction, persistence
  skills/          Skill discovery, rendering, and frontmatter parsing
  tool/            Tool executor, registry, and truncation
  tools/           Built-in tool implementations
test/
  collab/          Multi-agent collaboration tests
```
