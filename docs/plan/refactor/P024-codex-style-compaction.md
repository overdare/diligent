---
id: P024
status: done
created: 2026-03-04
---

# Codex-style Compaction: Summary + Recent User Messages

## Context

Current compaction stores `firstKeptEntryId` on `CompactionEntry` — a back-reference into the session tree. The context-builder does `path.findIndex(e => e.id === firstKeptEntryId)` to locate kept entries, then re-injects full turns (user+assistant+tool_result). This is complex and fragile.

Codex-rs uses a simpler approach: summarize everything, independently collect recent **user-only** messages within a token budget, and store both directly on the compaction entry. No back-references needed.

No backward compatibility with v4 sessions is required.

## Goal

Replace `firstKeptEntryId` with `recentUserMessages: Message[]` on `CompactionEntry`. Delete `findCutPoint`. Context rebuilding becomes: `[recent user messages] → [SUMMARY_PREFIX + summary] → [new turns]`.

## Key Insights from Codex-rs

Studied `docs/references/codex/codex-rs/core/src/compact.rs`:

1. **Message ordering**: `build_compacted_history` puts recent user messages FIRST, then summary LAST — summary is the final "briefing" before new turns begin
2. **Summarize all, preserve independently**: ALL entries are summarized; recent user messages are selected independently (not a split like findCutPoint)
3. **`SUMMARY_PREFIX`** marker: "Another language model started to solve this problem..." — used to distinguish summary injections from real user messages
4. **`is_summary_message` filter**: Skip messages starting with `SUMMARY_PREFIX` when collecting user messages — prevents summary accumulation in iterative compactions
5. **Reverse walk with truncation**: Walk user messages backwards (most recent first), select within `COMPACT_USER_MESSAGE_MAX_TOKENS = 20_000`, truncate overlong individual messages
6. **Handoff prompt framing**: "You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM..."

## Cache Efficiency Verification

Concern: if recent user messages are recomputed each context build, the API prefix cache breaks.

**Analysis**: `recentUserMessages` are computed ONCE during `performCompaction` and stored immutably on the `CompactionEntry` (persisted to JSONL). Every subsequent `buildSessionContext` call reads the stored messages verbatim. New turns are appended AFTER the summary, so the prefix `[recent user msgs] + [summary]` is **stable across all context builds** until the next compaction.

Repair functions don't break this:
- `normalizeToolMessages`: only affects assistant messages with tool_calls — prefix contains only user messages, safe
- `deduplicateUserMessages`: only removes consecutive identical user messages — would require exact duplicate content between prefix and post-compaction messages (effectively impossible)

## What Changes

| File | Change |
|------|--------|
| `packages/core/src/session/types.ts` | `SESSION_VERSION` 4→5, `CompactionEntry`: remove `firstKeptEntryId`, add `recentUserMessages: Message[]` |
| `packages/core/src/session/compaction.ts` | Delete `findCutPoint`/`CutPointResult`, add `findRecentUserMessages`, `SUMMARY_PREFIX`, `isSummaryMessage`, update prompts to handoff framing |
| `packages/core/src/session/context-builder.ts` | Use `recentUserMessages` directly, new ordering `[recent user msgs → summary → new turns]` |
| `packages/core/src/session/manager.ts` | `performCompaction` uses `findRecentUserMessages`, summarizes ALL entries |
| `packages/core/src/session/index.ts` | Update exports |
| `packages/core/src/index.ts` | Update exports |
| `packages/debug-viewer/src/shared/types.ts` | Add `recentUserMessages` to mirror |
| `packages/core/test/compaction.test.ts` | Replace `findCutPoint` tests with `findRecentUserMessages` + `isSummaryMessage` tests |
| `packages/core/test/session-context-builder.test.ts` | Update CompactionEntry shape, assert new ordering |

## What Does NOT Change

- Compaction trigger logic (`shouldCompact`, `estimateTokens`)
- File operation tracking (`extractFileOperations`, `formatFileOperations`)
- Tree structure (`parentId` chain)
- Protocol schemas / Web / TUI frontends

## Implementation

### Task 1: types.ts — CompactionEntry

```typescript
export const SESSION_VERSION = 5;

export interface CompactionEntry {
  type: "compaction";
  id: string;
  parentId: string | null;
  timestamp: string;
  summary: string;
  recentUserMessages: Message[];  // replaces firstKeptEntryId
  tokensBefore: number;
  tokensAfter: number;
  details?: CompactionDetails;
}
```

### Task 2: compaction.ts — Core Logic

**Delete**: `CutPointResult` interface, `findCutPoint` function

**Add**:

```typescript
// Codex-rs summary_prefix.md
export const SUMMARY_PREFIX =
  "Another language model started to solve this problem and produced a summary " +
  "of its thinking process. You also have access to the state of the tools that " +
  "were used by that language model. Use this to build on the work that has " +
  "already been done and avoid duplicating work. Here is the summary produced " +
  "by the other language model, use the information in this summary to assist " +
  "with your own analysis:";

export function isSummaryMessage(msg: Message): boolean {
  if (msg.role !== "user" || typeof msg.content !== "string") return false;
  return msg.content.startsWith(`${SUMMARY_PREFIX}\n`);
}

export interface RecentUserMessagesResult {
  recentUserMessages: Message[];
  entriesToSummarize: SessionEntry[];
}

export function findRecentUserMessages(
  pathEntries: SessionEntry[],
  keepRecentTokens: number,
): RecentUserMessagesResult {
  // 1. Find startIndex after last compaction
  // 2. entriesToSummarize = all entries from startIndex
  // 3. Collect user messages (excluding isSummaryMessage), include steering
  // 4. Walk backwards within token budget, truncate overlong msgs
  // 5. Reverse to chronological order
}

function truncateUserMessage(msg: Message, maxTokens: number): Message {
  if (msg.role !== "user" || typeof msg.content !== "string") return msg;
  const maxChars = maxTokens * 4;
  if (msg.content.length <= maxChars) return msg;
  return { ...msg, content: msg.content.slice(0, maxChars) + "\n[... truncated]" };
}
```

**Update prompts** — add handoff framing to `SUMMARIZATION_PROMPT` and `UPDATE_SUMMARIZATION_PROMPT`:

```
You are performing a CONTEXT CHECKPOINT COMPACTION.
Create a handoff summary for another LLM that will resume this coding task.

[...keep existing structured sections: Goal, Progress, Key Decisions, Next Steps, Critical Context...]

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.
```

### Task 3: context-builder.ts — New Ordering

Replace the compaction branch (current lines 65-98):

```typescript
import { formatFileOperations, SUMMARY_PREFIX } from "./compaction";

if (lastCompaction) {
  // 1. Inject recent user messages (chronological, stored on CompactionEntry)
  for (const msg of lastCompaction.recentUserMessages) {
    messages.push(msg);
  }

  // 2. Inject summary with SUMMARY_PREFIX (last in prefix = stable for cache)
  const summaryWithFiles = lastCompaction.details
    ? lastCompaction.summary + formatFileOperations(lastCompaction.details)
    : lastCompaction.summary;
  messages.push({
    role: "user",
    content: `${SUMMARY_PREFIX}\n\n${summaryWithFiles}`,
    timestamp: Date.parse(lastCompaction.timestamp),
  });

  // 3. Process entries AFTER compactionIndex only (new turns)
  for (let i = compactionIndex + 1; i < path.length; i++) {
    const entry = path[i];
    if (entry.type === "compaction") continue;
    switch (entry.type) {
      case "message": messages.push(entry.message); break;
      case "steering": messages.push(entry.message); break;
      case "model_change": currentModel = { provider: entry.provider, modelId: entry.modelId }; break;
    }
  }
}
```

Context after compaction:
```
[user: recent msg 1]          ← stored on CompactionEntry, stable prefix
[user: recent msg 2]          ← stored on CompactionEntry, stable prefix
[user: SUMMARY_PREFIX + summary + file_ops]  ← stored on CompactionEntry, stable prefix
[user: new question]           ← new turn, appended at end
[assistant: response]          ← new turn
```

### Task 4: manager.ts — performCompaction

```typescript
import { findRecentUserMessages } from "./compaction";
// remove: findCutPoint

const pathEntries = this.getPathEntries();
const result = findRecentUserMessages(pathEntries, compactionConfig.keepRecentTokens);

if (result.entriesToSummarize.length === 0) { /* early exit */ }

// Summarize ALL entries (not a subset)
const messagesToSummarize: Message[] = [];
for (const entry of result.entriesToSummarize) {
  if (entry.type === "message") messagesToSummarize.push(entry.message);
  else if (entry.type === "steering") messagesToSummarize.push(entry.message);
}

const details = extractFileOperations(messagesToSummarize, previousCompaction?.details);
const summary = await generateSummary(messagesToSummarize, ...);

const compactionEntry: CompactionEntry = {
  type: "compaction",
  id: generateEntryId(),
  parentId: this.leafId,
  timestamp: new Date().toISOString(),
  summary,
  recentUserMessages: result.recentUserMessages,
  tokensBefore,
  tokensAfter: 0,
  details,
};
```

### Task 5: Export Updates

**`packages/core/src/session/index.ts`**:
- Remove: `CutPointResult` type, `findCutPoint` value
- Add: `RecentUserMessagesResult` type, `findRecentUserMessages`, `isSummaryMessage`, `SUMMARY_PREFIX` values

**`packages/core/src/index.ts`**:
- Same pattern: replace `CutPointResult`/`findCutPoint` with new exports

### Task 6: debug-viewer types

```typescript
export interface CompactionEntry {
  id: string;
  parentId?: string;
  type: "compaction";
  summary: string;
  recentUserMessages?: Array<{
    role: string;
    content: string | ContentBlock[];
    timestamp?: number;
  }>;
  details?: { readFiles: string[]; modifiedFiles: string[] };
  timestamp: number;
}
```

### Task 7: Update Tests

**`packages/core/test/compaction.test.ts`**:
- Delete `findCutPoint` describe block (lines 141-213)
- Add `isSummaryMessage` tests: summary-prefixed user msg → true, regular → false, non-user → false
- Add `findRecentUserMessages` tests: empty entries, all within budget, budget exceeded (most recent first), starts after last compaction, filters summary messages, truncates overlong msgs, chronological order

**`packages/core/test/session-context-builder.test.ts`**:
- All CompactionEntry literals: remove `firstKeptEntryId`, add `recentUserMessages: Message[]`
- Update assertions: first messages are recent user msgs, followed by summary with `SUMMARY_PREFIX`, then new turns
- Add test for `isSummaryMessage` filtering in iterative compaction scenario

## Verification

1. `bun run typecheck` — all packages pass
2. `bun test packages/core/test/compaction.test.ts`
3. `bun test packages/core/test/session-context-builder.test.ts`
4. `bun test` — full suite
5. Manual: long TUI session → compaction triggers → JSONL has `recentUserMessages`, no `firstKeptEntryId`
6. Manual: trigger compaction twice → iterative summary updates, no summary accumulation in recentUserMessages

## Risk Areas

| Risk | Mitigation |
|------|-----------|
| `recentUserMessages` JSONL line size | Bounded by 20K token budget (~80K chars max) |
| Summary accumulation in iterative compaction | `isSummaryMessage` filter excludes previous summary injections from user message collection |
| Repair functions modifying prefix | Verified: `normalizeToolMessages` only touches assistant+tool_result; `deduplicateUserMessages` only removes consecutive identical content (not possible between prefix and new turns) |
