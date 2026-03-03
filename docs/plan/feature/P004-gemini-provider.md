---
id: P004
status: done
created: 2026-02-28
---

status: done
---

# Plan: Add Gemini as LLM Provider

## Context

Diligent currently supports Anthropic and OpenAI as LLM providers. The user wants to add Google Gemini as a third provider, following the same patterns used by the existing providers.

The provider system is function-based (no class hierarchy) — each provider exports a `createXxxStream(apiKey, baseUrl?): StreamFunction` factory. The `ProviderManager` in the CLI dispatches to the correct provider based on `model.provider`.

## Approach

Use the `@google/genai` SDK (`GoogleGenAI`) with its `generateContentStream` API for streaming, function calling via `functionDeclarations` in tools config, and `thinkingConfig` for extended thinking.

## Files to Modify

### 1. Install SDK dependency
- `packages/core/package.json` — add `@google/genai` dependency

### 2. New file: `packages/core/src/provider/gemini.ts`
Create `createGeminiStream(apiKey: string, baseUrl?: string): StreamFunction` following the OpenAI provider pattern:

- **Client init**: `new GoogleGenAI({ apiKey })` (no baseUrl support in SDK — ignore for now or use httpOptions)
- **Message conversion** (`convertToGeminiContents`): Map internal `Message[]` to Gemini `Content[]`:
  - `user` messages → `{ role: "user", parts: [{ text }] }`
  - `assistant` messages → `{ role: "model", parts: [{ text }, { functionCall: { name, args } }] }`
  - `tool_result` messages → `{ role: "user", parts: [{ functionResponse: { name, response: { output } } }] }`
  - Skip `thinking` blocks (not needed in conversation history)
- **Tool conversion** (`convertToGeminiTools`): Map `ToolDefinition[]` to `[{ functionDeclarations: [{ name, description, parameters }] }]`
- **System instructions**: Pass via `config.systemInstruction`
- **Thinking support**: When `model.supportsThinking && budgetTokens`, pass `config.thinkingConfig: { thinkingBudget: budgetTokens }`
- **Streaming**: `ai.models.generateContentStream({ model, contents, config })` then `for await (const chunk of response)`
  - Each chunk has `.candidates[0].content.parts[]` — iterate parts:
    - `part.text` → emit `text_delta`
    - `part.functionCall` → emit `tool_call_start` + `tool_call_end` (Gemini sends function calls as complete objects, not deltas)
    - `part.thought` → emit `thinking_delta` (if thinking is enabled)
  - On stream completion: build final `AssistantMessage` from accumulated `contentBlocks`
  - `chunk.usageMetadata` → emit `usage` (promptTokenCount → inputTokens, candidatesTokenCount → outputTokens)
- **Error classification** (`classifyGeminiError`): Similar pattern to OpenAI — check for rate limit (429), auth (401/403), context overflow, network errors
- **Tool call IDs**: Gemini doesn't use call IDs like OpenAI/Anthropic — generate synthetic IDs (e.g., `gemini-{name}-{counter}`)

### 3. `packages/core/src/provider/models.ts`
- Add Gemini models to `KNOWN_MODELS`:
  ```
  gemini-2.5-pro    | gemini | 1M context | 64K output | thinking: yes (10K) | aliases: [gemini-pro]
  gemini-2.5-flash  | gemini | 1M context | 65K output | thinking: yes (10K) | aliases: [gemini-flash, gemini]
  ```
- Update `resolveModel()`: Add `if (modelId.startsWith("gemini-"))` → provider `"gemini"`, context 1M, max output 65K

### 4. `packages/core/src/provider/index.ts`
- Export `createGeminiStream` and `classifyGeminiError`

### 5. `packages/core/src/config/schema.ts`
- Add `gemini` to the provider Zod schema:
  ```typescript
  gemini: z.object({
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional(),
  }).optional(),
  ```

### 6. `packages/core/src/config/loader.ts`
- Add `GEMINI_API_KEY` env var mapping in `applyEnvOverrides()`:
  ```typescript
  if (env.GEMINI_API_KEY) {
    result.provider = { ...result.provider, gemini: { ...result.provider?.gemini, apiKey: env.GEMINI_API_KEY } };
  }
  ```

### 7. `packages/cli/src/provider-manager.ts`
- Add `"gemini"` to `ProviderName` union and `PROVIDER_NAMES` array
- Add `gemini: "gemini-2.5-flash"` to `DEFAULT_MODELS`
- In constructor: read `config.provider?.gemini?.apiKey ?? process.env.GEMINI_API_KEY`
- In constructor: read `config.provider?.gemini?.baseUrl`
- In `createProxyStream()`: update error message env var hint for gemini
- In `getOrCreateStream()`: add gemini branch → `createGeminiStream(apiKey, baseUrl)`

### 8. `packages/cli/src/config-writer.ts`
- Update `saveApiKey()` type: `"anthropic" | "openai" | "gemini"`

### 9. `packages/cli/src/tui/commands/builtin/provider.ts`
- Update `promptApiKey()` hint URL for gemini: `https://aistudio.google.com/apikey`
- Update placeholder: `"AIza..."` for gemini

## Verification

1. `bun install` — install `@google/genai` dependency
2. `bun run typecheck` — ensure no type errors
3. `bun run lint` — ensure no lint errors
4. `bun test` — ensure existing tests pass
5. Manual test: set `GEMINI_API_KEY` env var and run with `--model gemini-2.5-flash`
