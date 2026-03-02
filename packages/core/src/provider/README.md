# provider

LLM provider streaming implementations and shared utilities.

```
provider/
  anthropic.ts        Anthropic Claude provider with streaming and tool use
  chatgpt.ts          ChatGPT subscription stream via raw fetch + OAuth
  errors.ts           Network error classification helpers
  gemini.ts           Google Gemini provider with streaming
  models.ts           Known model definitions and resolver
  openai.ts           OpenAI provider with SDK streaming and error handling
  openai-shared.ts    Shared OpenAI Responses API utilities (message conversion, event loop)
  retry.ts            Retry wrapper with exponential backoff
  system-sections.ts  System prompt section flattening
  types.ts            Provider types and ProviderError
```
