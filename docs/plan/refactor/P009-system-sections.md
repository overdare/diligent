---
id: P009
status: done
created: 2026-03-02
---

status: done
---

# SystemSection[] Architecture

## Context

System prompt is currently a flat `string` throughout the pipeline. This loses semantic structure — providers that support structured system messages (Anthropic's `TextBlockParam[]` with `cache_control`) can't leverage it. Converting to a typed section array enables per-provider rendering and future prompt caching optimization.

## New Type

```typescript
// in provider/types.ts
export interface SystemSection {
  tag?: string;                          // XML wrapper: "knowledge", "user_instructions", "collaboration_mode"
  tagAttributes?: Record<string, string>; // e.g. { path: "/p/AGENTS.md" }
  label: string;                          // debug label: "base", "knowledge", "mode"
  content: string;                        // raw text content
  cacheControl?: "ephemeral";             // hint for Anthropic cache breakpoints
}
```

## New File: `packages/core/src/provider/system-sections.ts`

Two render functions:

- **`flattenSections(sections: SystemSection[]): string`** — for OpenAI/Gemini/ChatGPT. Wraps each section in its XML tag (if set), joins with `\n\n`.
- **`toAnthropicBlocks(sections: SystemSection[]): TextBlockParam[]`** — for Anthropic. Each section → `{ type: "text", text: "..." }`, with `cache_control` if set.

## Changes by File

### 1. `packages/core/src/provider/types.ts` (line 23)
- Add `SystemSection` interface (exported)
- `StreamContext.systemPrompt`: `string` → `SystemSection[]`

### 2. `packages/core/src/agent/types.ts` (line 72)
- `AgentLoopConfig.systemPrompt`: `string` → `SystemSection[]`

### 3. `packages/core/src/config/instructions.ts`
- `buildSystemPrompt()` returns `SystemSection[]` — each part becomes a section:
  - `{ label: "base", content: basePrompt }`
  - `{ tag: "user_instructions", tagAttributes: { path }, label: "instructions", content, cacheControl: "ephemeral" }`
  - `{ label: "additional", content }` per additional instruction
- `buildSystemPromptWithKnowledge()` returns `SystemSection[]`:
  - `{ label: "base", content: basePrompt }`
  - `{ tag: "knowledge", label: "knowledge", content, cacheControl: "ephemeral" }`
  - `{ label: "skills", content: skillsSection }`
  - `{ tag: "user_instructions", ... }` per instruction
  - `{ label: "additional", content }` per additional
  - `{ label: "knowledge_instruction", content: KNOWLEDGE_INSTRUCTION }`

### 4. `packages/core/src/agent/loop.ts`
- `effectiveSystemPrompt` becomes `SystemSection[]`
- Mode suffix: push `{ tag: "collaboration_mode", label: "mode", content: MODE_SYSTEM_PROMPT_SUFFIXES[activeMode] }` instead of string concat
- `streamAssistantResponse` parameter: `string` → `SystemSection[]`
- `StreamContext.systemPrompt` already takes the array

### 5. `packages/core/src/provider/anthropic.ts` (line 42)
- `system: toAnthropicBlocks(context.systemPrompt)`

### 6. `packages/core/src/provider/openai.ts` (line 36)
- `instructions: flattenSections(context.systemPrompt)`

### 7. `packages/core/src/provider/gemini.ts` (line 42)
- `systemInstruction: flattenSections(context.systemPrompt)` (keep truthy guard)

### 8. `packages/core/src/provider/chatgpt.ts` (line 62)
- `body.instructions = flattenSections(context.systemPrompt)` (keep truthy guard on `context.systemPrompt.length > 0`)

### 9. `packages/core/src/collab/types.ts` (line 34)
- `CollabToolDeps.systemPrompt`: `string` → `SystemSection[]`

### 10. `packages/core/src/tools/task.ts` (line 16)
- `TaskToolDeps.systemPrompt`: `string` → `SystemSection[]`

### 11. `packages/core/src/collab/registry.ts` (line 53-55)
- `systemPromptPrefix` handling: instead of string prepend, unshift a new section:
  ```typescript
  const childSections = agentType.systemPromptPrefix
    ? [{ label: "agent_role", content: agentType.systemPromptPrefix }, ...deps.systemPrompt]
    : [...deps.systemPrompt];
  ```

### 12. `packages/core/src/tools/task.ts` (line 55-57)
- Same pattern as collab/registry.ts for `systemPromptPrefix`

### 13. `packages/core/src/session/compaction.ts` (line 176)
- Wrap summarization prompt: `systemPrompt: [{ label: "system", content: prompt }]`

### 14. `packages/cli/src/config.ts`
- `AppConfig.systemPrompt`: `string` → `SystemSection[]`
- `loadConfig()` already calls `buildSystemPromptWithKnowledge()` — just type changes
- `config.systemPrompt` override from jsonc: wrap in `[{ label: "base", content: customPrompt }]` before passing to `buildSystemPromptWithKnowledge`, or handle at call site

### 15. `packages/core/src/config/schema.ts` (line 38)
- `systemPrompt` in DiligentConfig stays `z.string().optional()` — it's the user-facing config value, not the internal representation

### 16. Exports
- `packages/core/src/provider/index.ts` — export `SystemSection`, `flattenSections`, `toAnthropicBlocks`
- `packages/core/src/index.ts` — re-export `SystemSection`

## Test Updates (~14 files, mechanical)

All test files that set `systemPrompt: "some string"` need to change to `systemPrompt: [{ label: "test", content: "some string" }]`.

Files: `agent-loop.test.ts`, `agent-mode-filter.test.ts`, `agent-loop-steering.test.ts`, `agent-loop-retry.test.ts`, `provider-retry.test.ts`, `config-instructions.test.ts`, `config-loader.test.ts`, `config-schema.test.ts`, `tools-task.test.ts`, `session-manager.test.ts`, `session-steering.test.ts`, `tui-app.test.ts`, `runner.test.ts`, `provider-command.test.ts`, `provider-manager.test.ts`, `e2e/conversation.test.ts`

For `agent-mode-filter.test.ts`: assertions change from string checks (`.toStartWith`, `.toContain("<collaboration_mode>")`) to section array checks (find section with `tag: "collaboration_mode"`).

For `config-instructions.test.ts`: assertions change to check section array structure instead of string content.

## Implementation Order

1. Add `SystemSection` type + `system-sections.ts` (new file, no breakage)
2. Change `StreamContext.systemPrompt` to `SystemSection[]` + update all 4 providers
3. Change `instructions.ts` return types to `SystemSection[]`
4. Change `AgentLoopConfig.systemPrompt` + update `loop.ts`
5. Update collab/task deps types + registry/task prefix handling
6. Update `compaction.ts`
7. Update CLI `AppConfig` + `config.ts`
8. Update all tests
9. `bun test` + `bun run typecheck`

## Verification

```bash
bun run typecheck          # no type errors
bun test                   # all ~739 tests pass
bun run lint               # clean
```
