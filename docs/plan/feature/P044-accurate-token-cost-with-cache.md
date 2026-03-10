---
id: P044
status: draft
created: 2026-03-10
---

# Accurate Token Cost Calculation with Cache Token Support

## Goal

Cost calculation accounts for cache tokens (read/write) per provider, and each provider correctly normalizes its token usage so `inputTokens` always means "non-cached input tokens only."

Currently `calculateCost()` ignores `cacheReadTokens`/`cacheWriteTokens`, and OpenAI doesn't parse `cached_tokens` from the API at all. This leads to inaccurate cost reporting.

## Prerequisites

None — all changes are to existing code.

## Key Insight: Provider Normalization

Different providers report `inputTokens` differently:

| Provider | `inputTokens` includes cached? | Cache read field | Cache write field |
|----------|-------------------------------|-----------------|-------------------|
| **Anthropic** | No (excludes cache) | `cache_read_input_tokens` | `cache_creation_input_tokens` |
| **OpenAI** | Yes (includes cache) | `input_tokens_details.cached_tokens` | N/A (automatic) |
| **Gemini** | N/A (no cache reporting) | — | — |

After normalization, all providers produce the same `Usage` shape where `inputTokens` = non-cached input only.

## Cache Token Pricing

| Provider | Cache Read Rate | Cache Write Rate |
|----------|----------------|-----------------|
| **Anthropic** | 10% of input price | 125% of input price |
| **OpenAI** | 50% of input price | 0 (free, automatic) |
| **Gemini** | N/A | N/A |

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| `packages/core/src/provider/types.ts` | Add `cacheReadCostPer1M`, `cacheWriteCostPer1M` to `Model` |
| `packages/core/src/provider/models.ts` | Add cache pricing to all models |
| `packages/core/src/agent/loop.ts` | `calculateCost()` includes cache token costs |
| `packages/core/src/provider/openai-shared.ts` | Parse `input_tokens_details.cached_tokens`, normalize `inputTokens` |
| Tests | Update cost calculation tests |

### What does NOT change

- `Usage` interface (already has `cacheReadTokens`/`cacheWriteTokens`)
- Anthropic provider (already correctly parses cache tokens, `inputTokens` already excludes cache)
- Gemini provider (no cache reporting available)
- Protocol schema
- UI display (already shows cache tokens in tooltip)
- 200K+ tier pricing (not needed — always under 200K)

## File Manifest

### packages/core/src/provider/

| File | Action | Description |
|------|--------|------------|
| `types.ts` | MODIFY | Add `cacheReadCostPer1M?`, `cacheWriteCostPer1M?` to `Model` |
| `models.ts` | MODIFY | Add cache pricing for all Anthropic and OpenAI models |
| `openai-shared.ts` | MODIFY | Parse cached_tokens, subtract from inputTokens |

### packages/core/src/agent/

| File | Action | Description |
|------|--------|------------|
| `loop.ts` | MODIFY | `calculateCost()` adds cache read/write costs |

### Tests

| File | Action | Description |
|------|--------|------------|
| Relevant test files | MODIFY | Verify cost calculation with cache tokens |

## Implementation Tasks

### Task 1: Add cache cost fields to Model interface

**Files:** `packages/core/src/provider/types.ts`

```typescript
export interface Model {
  // ... existing fields
  inputCostPer1M?: number;
  outputCostPer1M?: number;
  cacheReadCostPer1M?: number;   // NEW
  cacheWriteCostPer1M?: number;  // NEW
}
```

### Task 2: Add cache pricing to model registry

**Files:** `packages/core/src/provider/models.ts`

Anthropic models — cache read = 10% of input, cache write = 125% of input:

```typescript
{
  id: "claude-opus-4-6",
  inputCostPer1M: 5.0,
  outputCostPer1M: 25.0,
  cacheReadCostPer1M: 0.5,    // 5.0 * 0.10
  cacheWriteCostPer1M: 6.25,  // 5.0 * 1.25
  // ...
},
{
  id: "claude-sonnet-4-6",
  inputCostPer1M: 3.0,
  outputCostPer1M: 15.0,
  cacheReadCostPer1M: 0.3,    // 3.0 * 0.10
  cacheWriteCostPer1M: 3.75,  // 3.0 * 1.25
  // ...
},
{
  id: "claude-haiku-4-5",
  inputCostPer1M: 1.0,
  outputCostPer1M: 5.0,
  cacheReadCostPer1M: 0.1,    // 1.0 * 0.10
  cacheWriteCostPer1M: 1.25,  // 1.0 * 1.25
  // ...
},
```

OpenAI models — cache read = 50% of input, no write cost:

```typescript
{
  id: "gpt-5.4",
  inputCostPer1M: 2.5,
  outputCostPer1M: 15.0,
  cacheReadCostPer1M: 1.25,   // 2.5 * 0.50
  cacheWriteCostPer1M: 0,     // free (automatic caching)
  // ...
},
// ... same pattern for other OpenAI models
```

Gemini models — no cache fields (leave undefined, treated as 0).

### Task 3: Update calculateCost()

**Files:** `packages/core/src/agent/loop.ts`

```typescript
export function calculateCost(model: Model, usage: Usage): number {
  const inputCost = (usage.inputTokens / 1_000_000) * (model.inputCostPer1M ?? 0);
  const outputCost = (usage.outputTokens / 1_000_000) * (model.outputCostPer1M ?? 0);
  const cacheReadCost = (usage.cacheReadTokens / 1_000_000) * (model.cacheReadCostPer1M ?? 0);
  const cacheWriteCost = (usage.cacheWriteTokens / 1_000_000) * (model.cacheWriteCostPer1M ?? 0);
  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}
```

### Task 4: Parse OpenAI cached tokens and normalize inputTokens

**Files:** `packages/core/src/provider/openai-shared.ts`

The OpenAI Responses API returns `input_tokens_details.cached_tokens` on `response.completed`. Update `mapUsage` to accept the full usage object:

```typescript
export function mapUsage(
  usage: {
    input_tokens: number;
    output_tokens: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  } | undefined,
): Usage {
  const cachedTokens = usage?.input_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: (usage?.input_tokens ?? 0) - cachedTokens,  // Non-cached only
    outputTokens: usage?.output_tokens ?? 0,
    cacheReadTokens: cachedTokens,
    cacheWriteTokens: 0,  // OpenAI doesn't report write tokens
  };
}
```

Also update the `response.completed` handler in `handleResponsesAPIEvents` to pass the full usage object (currently it casts to `{ input_tokens; output_tokens }` only):

```typescript
case "response.completed": {
  const resp = event.response as Record<string, unknown>;
  if (resp) {
    const u = resp.usage as {
      input_tokens: number;
      output_tokens: number;
      input_tokens_details?: { cached_tokens?: number };
      output_tokens_details?: { reasoning_tokens?: number };
    } | undefined;
    usage = mapUsage(u);
    stopReason = mapStopReason(resp.status as string);
  }
  break;
}
```

### Task 5: Tests

Verify:

1. **calculateCost with cache tokens** — Given Anthropic model + usage with cache tokens, cost includes cache read/write components
2. **calculateCost without cache tokens** — Backward compatible, same as before when cache tokens are 0
3. **OpenAI mapUsage normalization** — `inputTokens` is reduced by `cached_tokens`, `cacheReadTokens` equals `cached_tokens`
4. **OpenAI mapUsage without details** — Still works when `input_tokens_details` is undefined

**Verify:** `bun test`

## Acceptance Criteria

1. `bun test` — all tests pass
2. Anthropic cost includes cache read (10% of input rate) and cache write (125% of input rate) components
3. OpenAI `inputTokens` is normalized (cached tokens subtracted), cache read tokens at 50% rate
4. Gemini unchanged (no cache token support)
5. UI tooltip already shows cache tokens — now the cost number is accurate too

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| OpenAI `input_tokens_details` might be undefined on some models | cacheReadTokens = 0, falls back to old behavior | Graceful fallback with `?? 0` |
| Anthropic pricing changes | Wrong cost numbers | Model registry is easy to update |

## Decisions Referenced

None — this is a correctness fix, not an architectural change.
