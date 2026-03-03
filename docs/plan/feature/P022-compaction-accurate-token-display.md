---
id: P022
status: done
created: 2026-03-03
---

# Compaction System: Accurate Token Display and Proportional Buffer

## Goal

Users see real-time, accurate context window usage (`Xk / Yk (X%)`) in both TUI and Web, with compaction triggering earlier via a proportional reserve (16% of context window) instead of a fixed 16k buffer.

## Prerequisites

None — all changes are to existing code.

## Artifact

**TUI status bar** (after at least one API call):
```
  claude-sonnet-4-6 · 15.2k / 200k (8%) · ~/git/project
```

**Web InputDock** (after at least one API call):
```
  connected · ~/git/project · 15.2k / 200k (8%) · $0.05
```

**Compaction triggers at ~84% of context window** instead of previous ~92%.

## Scope

### What changes

| Area | What Changes |
|------|-------------|
| packages/core/src/config/runtime.ts | Default `reserveTokens` = 16% of contextWindow |
| packages/core/src/session/manager.ts | Reactive compaction uses `max(heuristic, lastApiInputTokens)` |
| packages/cli/src/config.ts | Add `compaction` to `AppConfig` (pass through from runtime) |
| packages/cli/src/tui/components/status-bar.ts | Show `Xk / Yk (X%)` format |
| packages/cli/src/tui/app.ts | Set `contextWindow`, use only `inputTokens` for context |
| packages/cli/src/tui/runner.ts | Use `config.compaction` instead of recomputing defaults |
| packages/web/src/client/lib/thread-store.ts | Track `currentContextTokens` (latest, not cumulative) |
| packages/web/src/client/components/InputDock.tsx | Show `Xk / Yk (X%)` + cost |
| Tests | Update shouldCompact tests, add status bar context display test |

### What does NOT change

- Compaction algorithm itself (cut-point, summarization, file tracking)
- Protocol schema (`usage/updated` notification shape stays the same)
- `keepRecentTokens` default (remains 20k)
- Heuristic `estimateTokens()` function (chars/4) — still used as fallback

## File Manifest

### packages/core/src/config/

| File | Action | Description |
|------|--------|------------|
| `runtime.ts` | MODIFY | Proportional `reserveTokens` default |

### packages/core/src/session/

| File | Action | Description |
|------|--------|------------|
| `manager.ts` | MODIFY | Fix reactive compaction token estimate |

### packages/cli/src/

| File | Action | Description |
|------|--------|------------|
| `config.ts` | MODIFY | Add `compaction` to `AppConfig` |

### packages/cli/src/tui/

| File | Action | Description |
|------|--------|------------|
| `components/status-bar.ts` | MODIFY | New `Xk / Yk (X%)` format |
| `app.ts` | MODIFY | Pass `contextWindow`, use `inputTokens` only |
| `runner.ts` | MODIFY | Use passed compaction config |

### packages/web/src/client/

| File | Action | Description |
|------|--------|------------|
| `lib/thread-store.ts` | MODIFY | Add `currentContextTokens` field |
| `components/InputDock.tsx` | MODIFY | Context window display |

### Tests

| File | Action | Description |
|------|--------|------------|
| `packages/core/test/compaction.test.ts` | MODIFY | Update shouldCompact test values |
| `packages/cli/test/status-bar-mode.test.ts` | MODIFY | Add context display test |

## Implementation Tasks

### Task 1: Proportional reserveTokens default

**Files:** `packages/core/src/config/runtime.ts`

Change the fixed 16384 default to `contextWindow * 0.16`.

```typescript
// runtime.ts — line 108-112
compaction: {
  enabled: config.compaction?.enabled ?? true,
  reserveTokens: config.compaction?.reserveTokens
    ?? Math.floor((model?.contextWindow ?? 200_000) * 0.16),
  keepRecentTokens: config.compaction?.keepRecentTokens ?? 20000,
},
```

| Model | contextWindow | reserveTokens (new) | Triggers at |
|-------|--------------|---------------------|-------------|
| Claude Sonnet | 200k | 32k | 168k (84%) |
| Gemini 2.5 Flash | 1M | 160k | 840k (84%) |
| GPT-5.3 Codex | 400k | 64k | 336k (84%) |
| gpt-4.1 | 1M | 160k | 840k (84%) |

**Verify:** `bun test compaction` — shouldCompact boundary test needs updated values.

### Task 2: Pass compaction config through AppConfig

**Files:** `packages/cli/src/config.ts`, `packages/cli/src/tui/app.ts`, `packages/cli/src/tui/runner.ts`

Add `compaction` to `AppConfig` so consumers don't recompute defaults.

```typescript
// config.ts
export interface AppConfig {
  // ... existing fields
  compaction: { enabled: boolean; reserveTokens: number; keepRecentTokens: number };
}

export async function loadConfig(...): Promise<AppConfig> {
  // ...
  return {
    // ... existing fields
    compaction: runtime.compaction,
  };
}
```

Then in `app.ts:533-536` and `runner.ts:67-70`, replace:
```typescript
// Before
compaction: {
  enabled: this.config.diligent.compaction?.enabled ?? true,
  reserveTokens: this.config.diligent.compaction?.reserveTokens ?? 16384,
  keepRecentTokens: this.config.diligent.compaction?.keepRecentTokens ?? 20000,
},

// After
compaction: this.config.compaction,
```

**Verify:** No behavior change, just centralized defaults.

### Task 3: Fix reactive compaction token estimate

**Files:** `packages/core/src/session/manager.ts`

In `runWithCompaction` (line 170-172), reactive compaction currently uses heuristic-only estimate:

```typescript
// Before (line 171)
const tokens = estimateTokens(currentMessages);

// After
const tokens = Math.max(estimateTokens(currentMessages), this.lastApiInputTokens);
```

This ensures reactive compaction uses the same hybrid accuracy as proactive.

**Verify:** Reactive compaction path now consistent with proactive.

### Task 4: TUI status bar — context window display

**Files:** `packages/cli/src/tui/components/status-bar.ts`, `packages/cli/src/tui/app.ts`

**status-bar.ts** — replace the buggy `X% context left` with `Xk / Yk (X%)`:

```typescript
if (this.info.tokensUsed !== undefined) {
  if (this.info.contextWindow) {
    const pct = Math.round((this.info.tokensUsed / this.info.contextWindow) * 100);
    leftParts.push(
      `${formatTokensCompact(this.info.tokensUsed)} / ${formatTokensCompact(this.info.contextWindow)} (${pct}%)`
    );
  } else {
    leftParts.push(`${formatTokensCompact(this.info.tokensUsed)} used`);
  }
}
```

**app.ts** — two changes:

1. Set `contextWindow` at initialization (line 157):
```typescript
this.statusBar.update({
  model: this.config.model.id,
  contextWindow: this.config.model.contextWindow,
  status: "idle",
  cwd: process.cwd(),
  mode: this.currentMode,
});
```

2. Use only `inputTokens` for context tracking (line 474-477):
```typescript
if (event.type === "usage") {
  this.statusBar.update({
    tokensUsed: event.usage.inputTokens,
  });
}
```

Also update `contextWindow` on model change (in the reload config path where `this.statusBar.update({ model: newConfig.model.id })` is called).

**Verify:** Start TUI, send a message. Status bar shows `0 / 200k (0%)` before first response, then `Xk / 200k (Y%)` after.

### Task 5: Web — context window display

**Files:** `packages/web/src/client/lib/thread-store.ts`, `packages/web/src/client/components/InputDock.tsx`

**thread-store.ts** — add `currentContextTokens` to `ThreadState`:

```typescript
export interface ThreadState {
  // ... existing fields
  currentContextTokens: number; // latest turn's inputTokens (not cumulative)
}

// initialThreadState
currentContextTokens: 0,

// In reduceServerNotification, "usage/updated" case:
case "usage/updated":
  return {
    ...state,
    usage: {
      inputTokens: state.usage.inputTokens + notification.params.usage.inputTokens,
      outputTokens: state.usage.outputTokens + notification.params.usage.outputTokens,
      cacheReadTokens: state.usage.cacheReadTokens + notification.params.usage.cacheReadTokens,
      cacheWriteTokens: state.usage.cacheWriteTokens + notification.params.usage.cacheWriteTokens,
      totalCost: state.usage.totalCost + notification.params.cost,
    },
    currentContextTokens: notification.params.usage.inputTokens, // REPLACE, not accumulate
  };
```

**InputDock.tsx** — add `contextWindow` prop and update display:

```typescript
interface InputDockProps {
  // ... existing
  contextWindow: number;
}

// In the component:
const hasContext = state.currentContextTokens > 0;
const contextPct = contextWindow > 0
  ? Math.round((currentContextTokens / contextWindow) * 100)
  : 0;

// Display:
{hasContext ? (
  <>
    <span className="opacity-30">·</span>
    <span className="shrink-0 cursor-default opacity-70" title={formatUsageTooltip(usage)}>
      {formatTokenCount(currentContextTokens)} / {formatTokenCount(contextWindow)} ({contextPct}%) · ${usage.totalCost.toFixed(2)}
    </span>
  </>
) : hasUsage ? (
  // fallback for when we only have cumulative data
  <>
    <span className="opacity-30">·</span>
    <span className="shrink-0 cursor-default opacity-70" title={formatUsageTooltip(usage)}>
      {formatTokenCount(totalTokens)} tokens · ${usage.totalCost.toFixed(2)}
    </span>
  </>
) : null}
```

**App.tsx** — pass `contextWindow` from `availableModels`:

```typescript
const currentModelInfo = providerMgr.availableModels.find(m => m.id === providerMgr.currentModel);
// ... pass contextWindow={currentModelInfo?.contextWindow ?? 0}
```

**Verify:** Open Web UI, send a message. After first response, shows `Xk / 200k (Y%) · $0.05`.

### Task 6: Update tests

**Files:** `packages/core/test/compaction.test.ts`, `packages/cli/test/status-bar-mode.test.ts`

**compaction.test.ts** — `shouldCompact` tests use hardcoded `16_384`. Update to match new proportional values or use explicit parameters:

```typescript
describe("shouldCompact", () => {
  const RESERVE = Math.floor(200_000 * 0.16); // 32000

  it("returns true when tokens exceed threshold", () => {
    expect(shouldCompact(100_000, 200_000, RESERVE)).toBe(false);
    expect(shouldCompact(190_000, 200_000, RESERVE)).toBe(true);
  });

  it("handles edge case: exactly at threshold", () => {
    // threshold = 200000 - 32000 = 168000
    expect(shouldCompact(168_000, 200_000, RESERVE)).toBe(false);
    expect(shouldCompact(168_001, 200_000, RESERVE)).toBe(true);
  });
});
```

**status-bar-mode.test.ts** — add context display test:

```typescript
test("shows token context with Xk / Yk (X%) format", () => {
  const bar = new StatusBar();
  bar.update({ model: "test", tokensUsed: 15000, contextWindow: 200000 });
  const text = stripAnsi(bar.render(120).join(""));
  expect(text).toContain("15K / 200K (8%)");
});
```

**Verify:** `bun test` passes.

## Bugs Fixed (summary)

| Bug | Location | Fix |
|-----|----------|-----|
| "X% context left" shows USED% as LEFT% | `status-bar.ts:65-66` | Show `Xk / Yk (X%)` |
| `tokensUsed = inputTokens + outputTokens` | `app.ts:476` | Use only `inputTokens` |
| `contextWindow` never set in status bar | `app.ts:157` | Pass `model.contextWindow` |
| Reactive compaction ignores `lastApiInputTokens` | `manager.ts:171` | Use `max(heuristic, lastApiInputTokens)` |

## Acceptance Criteria

1. `bun test` — all tests pass
2. TUI status bar shows `Xk / Yk (X%)` after first API response
3. Web InputDock shows `Xk / Yk (X%) · $Y.YY` after first API response
4. Compaction triggers at 84% of context window (not 92%)
5. Reactive compaction uses same hybrid accuracy as proactive
6. No protocol schema changes (backward-compatible)

## Testing Strategy

| Category | What to Test | How |
|----------|-------------|-----|
| Unit | `shouldCompact` with new defaults | `bun test compaction` |
| Unit | Status bar format | `bun test status-bar` |
| Manual | TUI context display | Run TUI, send message, verify status bar |
| Manual | Web context display | Run Web, send message, verify InputDock |
| Manual | Compaction trigger | Long session, verify compaction triggers at ~84% |

## Risk Areas

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Large reserve for 1M windows (160k) | Earlier-than-expected compaction | Acceptable — 840k usable is still very large |
| `inputTokens` = 0 on first turn | Status bar shows `0 / 200k (0%)` | Acceptable — updates after first response |

## Decisions Referenced

| ID | Summary | Where Used |
|----|---------|------------|
| D038 | Token-based automatic compaction trigger | Task 1, 3 |
| D037 | LLM-based iterative summary updating | Not changed |
| D039 | File operation tracking across compactions | Not changed |
