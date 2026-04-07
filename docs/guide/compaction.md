# Compaction

This guide describes the current compaction behavior in Diligent.

## What compaction is for

Compaction reduces the active model context for long-running sessions while preserving enough structured information for the agent to continue the task.

Compaction is runtime behavior, not a separate storage layer. It changes how the next model input is reconstructed, while the full session transcript remains available for human inspection.

## Automatic and manual compaction

Compaction can happen in two ways:

- automatic compaction during a turn when the active context is too large
- manual compaction requested by the client for an idle thread

Manual compaction is exposed through the shared protocol method:

- `thread/compact/start`

Current client entry points:

- TUI: `/compact`
- Web: compaction action in the thread UI

Manual compaction is rejected if the thread is currently running.

## Default runtime settings

If runtime config does not override compaction, the current defaults are:

- `enabled: true`
- `reservePercent: 16`
- `keepRecentTokens: 20000`
- `timeoutMs: 180000`

These values are applied by `SessionManager` when preparing or manually compacting a thread.

## When automatic compaction triggers

The current trigger uses a reserve-threshold decision.

At a high level, compaction is considered when estimated active context exceeds:

- `contextWindow - floor(contextWindow * reservePercent / 100)`

In other words, Diligent keeps a proportional reserve instead of waiting until the context window is completely full.

## Token source behavior

The current decision path prefers concrete usage numbers from the latest assistant response when they are available.

More specifically, compaction compares:

- provider-reported assistant context usage from the latest assistant message
- estimated token count across all active messages

When assistant usage exists, Diligent uses the larger of the two values. When assistant usage is unavailable, it falls back to estimated message tokens only.

This is intentionally conservative: if the estimate is larger than the provider usage snapshot, Diligent still trusts the larger number for compaction decisions.

## What gets retained

Compaction does not simply drop all recent conversation.

The current selection behavior is:

- summarize the full active message set
- keep a recent tail of user messages within `keepRecentTokens`
- truncate an overlong retained user message if necessary

Retention is user-message-focused. The preserved tail is not “all recent messages”; it is specifically the recent user slice chosen within the configured token budget.

## Local vs native compaction

Diligent supports both local compaction flow and provider-native compaction when available.

### Local compaction

Local compaction generates a structured handoff summary with an LLM call, then rebuilds the compacted conversation as:

- retained recent user messages
- one synthetic user summary message

For local compaction, the stored summary is prefixed with handoff framing so the next model understands that it is resuming work summarized by a previous model.

### Native compaction

Native compaction allows the provider to return provider-owned compaction state instead of the same rebuilt summary-message form.

Current behavior:

- native compaction is used only when a native compaction function is available
- native compaction is skipped for small inputs below `NATIVE_COMPACTION_MIN_INPUT_TOKENS` (`50000`)
- when native compaction succeeds, Diligent can persist provider compaction state as `compactionSummary`

When `compactionSummary` exists, the rebuilt provider-visible context is restored from that provider-owned state rather than from a local summary message chain.

## Persistence behavior

Compaction is persisted as a dedicated session entry of type `compaction`.

A compaction entry can store:

- `summary`
- `displaySummary`
- `recentUserMessages`
- `compactionSummary`
- `tokensBefore`
- `tokensAfter`

This lets runtime preserve both model-reconstruction state and human-readable history.

## Context vs transcript behavior

Compaction affects model-visible context reconstruction differently from human transcript rendering.

### Context building

`buildSessionContext()` walks the session path, finds the latest compaction entry, and then reconstructs active model input from that point forward.

- with local compaction, runtime rebuilds messages from `recentUserMessages + summary`
- with native compaction, runtime restores `compactionSummary` and may inject only a condensed display marker into the visible message list
- entries before the latest compaction point are not replayed into active model context

### Transcript building

`buildSessionTranscript()` preserves the visible conversation history and records compaction as an explicit historical event instead of replacing older turns.

That distinction matters when debugging:

- transcript answers “what happened in this thread?”
- context answers “what can the model currently see?”

## Display summary rules

The summary shown to humans is not always identical to the raw summary used for model continuation.

Current behavior:

- local compaction usually exposes the generated summary itself
- native compaction may store a detailed internal summary while exposing a condensed `displaySummary`, commonly `Compacted`

This prevents provider-native compaction state from forcing the UI to show a large or provider-specific internal payload while still keeping transcript history explicit.

## User-visible signals

Runtime emits compaction lifecycle events and notifications such as:

- protocol request: `thread/compact/start`
- server notifications: `thread/compaction/started`, `thread/compacted`
- agent events: `compaction_start`, `compaction_end`

Clients use these signals to show progress and results.

Examples in current clients:

- TUI shows a compacting spinner and logs token reduction
- Web tracks `isCompacting`, rehydrates thread history after manual compaction, and clears compacting state on error

## Failure and timeout behavior

Compaction runs under its own abort signal and timeout budget.

- default timeout: `180000` ms
- manual compaction errors are surfaced back through the server error flow
- manual compaction always restores thread status to `idle` in a `finally` path

## Key code paths

- `packages/core/src/agent/compaction.ts`
- `packages/core/src/llm/compaction.ts`
- `packages/core/src/llm/provider/native-compaction.ts`
- `packages/runtime/src/session/manager.ts`
- `packages/runtime/src/session/context-builder.ts`
- `packages/runtime/src/app-server/thread-handlers.ts`
- `packages/cli/src/tui/commands/builtin/compact.ts`
- `packages/web/src/client/lib/use-app-actions.ts`
- `packages/core/test/agent/compaction.test.ts`
- `packages/core/test/llm/compaction.test.ts`
- `packages/core/test/llm/provider/native-compaction.test.ts`
