# 11 — LLM-free context pruning before summary compaction

Status: proposal · Depends on: none · Integrates with: 01 (Pre/PostCompact hooks), 08 (extraction trigger)

## Problem

When the context crosses the reserve threshold, Diligent's only options are an LLM summary (local) or a
provider-owned checkpoint (native). Both discard the conversation's structure. Most of a long session's tokens are
usually old tool output — file reads, test logs, search results — that the model could re-fetch, and dropping those
first would often avoid a summary entirely.

## Current state

| Fact | Evidence |
|---|---|
| Trigger: active tokens > `contextWindow − floor(contextWindow × reservePercent/100)`; `reservePercent` default 16 | `packages/core/src/agent/compaction.ts:23, 53-79`; `docs/guide/compaction.md` |
| Automatic compaction proceeds only when the selected candidate has ≥ 50 000 estimated tokens (local and native) | `docs/guide/compaction.md` "Eligibility, adoption, and rejection" |
| A result is adopted only if effective context shrinks; overflow recovery gets one bounded attempt | same guide |
| Two methods: local summary and provider-native | `compaction.ts:141-…`, `core/src/llm/provider/native-compaction` |
| Images are stripped from the summarizer's input but stay in context | `compaction.ts:88-97` |
| Large tool outputs are already spilled to disk by the executor (model sees head/tail + saved path) | `packages/core/src/tool/executor.ts:75-90` |
| Session file version 12; header version is validated on read | `runtime/src/session/types.ts:9`, `session/persistence.ts:66-75` |

## Reference survey

**oh-my-pi** `session/compaction-methods.ts:12-50`: ordered methods `remote`, `snapcompact`, `handoff`, `shake`, `soft`;
default order `["remote","snapcompact","handoff","shake","soft"]`. `shake` "drops recoverable heavy content in place
without an LLM call" with modes `elide` (whole tool results, large fenced/XML blocks), `images`, `thinking`, and records
tokens freed plus an artifact holding the originals (`session/shake-types.ts:8-30`). `snapcompact` renders history into
dense images read back by a vision model.

## Design

### Method order

```jsonc
"compaction": { "methods": ["prune", "native", "local"] }   // default; existing keys unchanged
```

On an automatic trigger, methods run in order until effective context is below `threshold − pruneMargin`
(`pruneMargin` = 5% of the window), and every method keeps the existing adoption rule (must shrink effective context).
`prune` has no 50 000-token minimum; `native`/`local` keep it. Manual `thread/compact/start` gains an optional
`method: "prune" | "summary"`; omitted = `summary` (today's behavior).

`snapcompact` is not adopted: it needs a vision model on every route and makes context opaque to text-only debugging,
which conflicts with Diligent's transparency goal.

### What `prune` removes

Only content outside a **protected tail**: the last 2 user turns and at least the last 40 000 tokens.

1. **Tool results** larger than 2 KB in the model-visible copy → replaced by
   `[Tool output elided to save context: <tool> <input summary>, <n> bytes. Re-run the tool or read <spill path>.]`.
   The full output is written to the tool-output store first (existing `ToolOutputFileStore`), so the stub always
   names a readable file.
2. **Images** in older user/tool messages → `[Image elided: <sha256 prefix>]`. The blob stays in the session sidecar.
3. **Thinking blocks** in older assistant messages → removed, except where the provider requires them to be replayed
   (the provider adapter declares a `thinkingReplay` policy; unknown → keep). `[INFERENCE — verify per provider]`
   Some provider APIs require thinking blocks only for the current tool-use turn; this is an adapter-owned rule, not
   a core assumption.

Tool-call blocks and their result IDs are never removed, so provider tool-call/result pairing stays valid.

### Persistence

New session entry, applied by context building only:

```ts
interface ContextPruneEntry {
  type: "context_prune";
  id: string; parentId: string | null; timestamp: string;
  targets: Array<{ entryId: string; blockIndex: number; kind: "tool_result" | "image" | "thinking"; stub: string }>;
  tokensBefore: number; tokensAfter: number;
}
```

- `buildSessionContext` applies all `context_prune` entries on the active path after the latest `compaction` entry;
  prunes before a compaction are irrelevant because that history is already summarized.
- `buildSessionTranscript` ignores them: the human transcript keeps full outputs.
- Requires bumping `SESSION_VERSION` to 13 (older runtimes must not silently drop prunes and over-fill context).
- Interaction with native checkpoints: when `compactionSummary` exists, only messages appended after the checkpoint
  are candidates.

### Prompt cache

Pruning rewrites old messages, invalidating the provider cache from the first pruned message. It runs only at the
same threshold crossing that would otherwise trigger a summary, which invalidates more, so it is never worse.

### Signals

Emits the existing `compaction_start`/`compaction_end` events with `method: "prune"`, and the existing
`thread/compacted` notification with `tokensBefore`/`tokensAfter`; the display label stays `Compacted`. Doc 01's
`PreCompact`/`PostCompact` hooks receive `method`.

## Risks

- **The model re-reads what it just lost**, costing tool calls. The protected tail and the 2 KB floor target only old,
  large outputs; evals compare total tokens and tool calls for long tasks with and without `prune`.
- **Stub paths outliving files** if the tool-output store is cleaned; the store's retention must be at least the
  session's lifetime (verify current retention before shipping).

## Tests

- `packages/core/test/agent/compaction-prune.test.ts`: protected tail respected; tool-call/result pairing intact;
  thinking kept when the adapter says so; adoption rejected when nothing shrinks.
- `packages/runtime/test/session/context-builder.test.ts`: `context_prune` applied to context, ignored by transcript,
  ignored before the latest `compaction`.
- `packages/e2e/app-server/compaction-prune.test.ts`: manual `method: "prune"` returns `compacted: true` and a resumed
  thread rebuilds the same pruned context.
