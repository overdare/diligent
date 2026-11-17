# 08 — Automatic knowledge extraction and consolidation

Status: proposal · Depends on: none · Integrates with: 01 (SessionEnd/Stop), 11 (compaction trigger)

## Problem

Project knowledge accumulates only when the model decides to call `update_knowledge` mid-task, which it rarely does.
Nothing reviews finished sessions for durable lessons, nothing merges duplicates, and stale or contradicted entries stay
ranked by their original confidence forever.

## Current state

| Fact | Evidence |
|---|---|
| Store: `<project>/.diligent/knowledge/knowledge.jsonl`, tolerant reads, serialized atomic read-modify-write | `packages/runtime/src/knowledge/store.ts:1-60` |
| Entry: `type` ∈ pattern/discovery/preference/correction/backlog, `confidence` 0–1, optional `supersedes`, `tags`, `sessionId` | `packages/protocol/src/data-model.ts:552-565` |
| Ranking: drop superseded, sort by confidence then recency | `knowledge/ranker.ts:8-13` |
| Injection: top 50 entries within an 8 192-token budget into the system prompt | `knowledge/injector.ts:6-49` |
| Writes only through the `update_knowledge` tool (upsert/delete) | `tools/update-knowledge.ts:5-31` |
| `knowledge.nudgeInterval` is accepted by the config schema but read nowhere — dead configuration | `config/schema.ts:170-177`; grep for `nudgeInterval` finds only the schema |
| The plan reminder is an existing periodic `<system-reminder>`: an `AgentLoopHook` that counts turns in `afterTurn`, resets on a `plan` tool result in `onToolResult`, resets on `restore`, and injects through `beforeTurn` every `planReminderIntervalTurns` (default 6) or right after compaction. It is registered in the main agent's `loopHooks` | `runtime/src/agent/plan-reminder-hook.ts:75-118`, `app-server/factory.ts:285-298`, `config/runtime.ts:276` |
| Goals use the same `beforeTurn` injection | `packages/core/src/agent/loop-hooks.ts:46`, `goals/tools.ts:24` |
| Model classes available for cheap background calls: `pro`, `general`, `lite` | `packages/core/src/llm/model-class.ts:2` |

## Reference survey

- **hermes-agent** `agent/background_review.py:1-6`: after a turn, a daemon thread replays the conversation snapshot in
  a forked agent and asks whether any memory/skill should be saved; writes go straight to the stores; the main
  conversation and its prompt cache are untouched. Triggered by nudge intervals (`memory.nudge_interval` and
  `skills.creation_nudge_interval`, default 10, `agent/agent_init.py:1159-1237`); disabled for one-shot runs.
- **oh-my-pi** `memories/index.ts:134-160`: background startup task runs phase 1 (per-session extraction) then phase 2
  (global consolidation); skipped for subagents (`taskDepth > 0`), sessions without a file, or a disabled config. Jobs
  and outputs live in SQLite (`memories/storage.ts:35-83`); settings include stage-1 concurrency 8, leases, and an input
  token limit (`memories/settings.ts:39-77`).

## Design

Three mechanisms, increasing in cost. Each is independently configurable.

### M0 — `nudgeInterval` as a sibling of the plan reminder

No new mechanism. `createKnowledgeNudgeHook({ intervalTurns, logger })` copies the structure of
`createPlanReminderHook`:

| Plan reminder (existing) | Knowledge nudge (new) |
|---|---|
| `afterTurn`: count turns since the plan was last surfaced | `afterTurn`: count turns since `update_knowledge` last ran |
| `onToolResult`: `plan` result resets the count | `onToolResult`: successful `update_knowledge` resets the count |
| `restore`: re-derive state from messages | `restore`: count = 0 |
| `beforeTurn`: inject when count ≥ interval, or after compaction | `beforeTurn`: inject when count ≥ interval; **not** after compaction |
| Only when the plan has unfinished steps | Only when `knowledge.enabled !== false` |

Injected content, wrapped in `<system-reminder>` like the plan reminder: "If this session has produced a durable,
project-specific fact, preference, or correction that a future session would need, record it with update_knowledge.
Otherwise ignore this reminder." Source label `knowledge-nudge`.

- Wiring: `app-server/factory.ts` `loopHooks`, next to the plan reminder, only when `nudgeInterval > 0`. The schema
  field already exists; the resolved runtime config gains `knowledgeNudgeIntervalTurns` the same way
  `planReminderIntervalTurns` is resolved.
- Default stays unset (off), so behavior changes only for users who already set it, who currently get nothing.
- Both reminders can fire on the same turn; they are separate injections with separate sources. The `<system-reminder>`
  prefix is shared, so the prefix constant moves to a small shared module.
- If later a third periodic reminder appears, the turn counting can be extracted into one helper; with two hooks,
  copying the 15-line pattern is simpler than a framework.

### M1 — Session extraction (stage 1)

**Trigger:** a root thread becomes idle (turn completed, no follow-up for 5 min) **or** is compacted **or** is
disposed, and at least `extractMinTurns` (default 4) user turns happened since the thread's watermark.

**Gating:** `knowledge.enabled !== false` and `knowledge.autoExtract === true` (default **false** until evals show
precision); never for collab children; never while the thread is running (the job is cancelled when a turn starts).

**Input:** the session path since the watermark, reduced to user messages, assistant text, tool **names** and error
flags, and compaction summaries. Raw tool output is excluded (see "Persistent prompt injection" below). Capped at
`extractInputTokens` (default 24 000) — oldest content trimmed first.

**Model:** `lite` class resolved from the thread's provider; structured output:

```ts
{ ops: Array<
  | { op: "create"; type: KnowledgeType; content: string; tags?: string[]; evidence: string }
  | { op: "reinforce"; id: string; evidence: string }
  | { op: "supersede"; id: string; content: string; evidence: string }
> }
```

**Apply rules** (in the repository layer, one mutation):

- `create` → confidence 0.5, tags include `auto`, `sessionId` set. Exact or near-duplicate content (normalized text
  equality) becomes `reinforce`.
- `reinforce` → confidence `min(0.9, c + 0.1)`.
- `supersede` → new entry with `supersedes: id`, confidence 0.6.
- `correction`/`preference` types created automatically are capped at 0.6 until a user confirms them.
- At most 5 ops per run; extras are dropped.

**Watermark:** `<knowledge dir>/extraction-state.json` → `{ [sessionId]: lastEntryId }`. Kept in the knowledge
directory, so the session file layout is unchanged.

**Visibility:** each applied op emits the existing `knowledge/saved` notification (`protocol/src/methods.ts:74`), so
clients can show "Learned: …" with an undo (existing `knowledge/update`).

### M2 — Consolidation (stage 2)

**Trigger:** after an M1 run when active entries exceed `2 × maxItems` (default 100), or the last consolidation is
older than 7 days.

**Work:** a `lite`-class call over the active entries (content, type, confidence, age, `auto` tag) that returns merge
and retire ops: merge duplicates into one entry superseding both; retire entries contradicted by newer corrections;
decay confidence of `auto` entries older than 30 days that were never reinforced (−0.1 per run, floor 0.2).
User-authored entries (no `auto` tag) are never retired automatically, only merged with a `supersedes` link so the
original stays recoverable.

### Costs and limits

One M1 run ≈ 24k input + ~1k output tokens on a `lite` model per qualifying idle period. Usage is attributed to the
thread (`usage/updated`) so it is never hidden. A per-project daily cap (`knowledge.autoExtractDailyRuns`, default 20)
bounds runaway cost.

## Risks

- **Persistent prompt injection.** Knowledge is injected into every future system prompt. If extraction read raw tool
  output (web pages, fetched files), hostile text could plant instructions that persist across sessions. Mitigations:
  extractor never sees raw tool output; `auto` entries are labelled as unverified in the injected section; automatic
  `preference`/`correction` entries are capped below user-confirmed ones.
- **Low-precision lessons** crowd the injection budget. Mitigated by default-off, the 5-op cap, decay, and evals.
- **Concurrency with manual edits.** The store already serializes read-modify-write per path within a process; a second
  runtime process on the same project can race (existing limitation, unchanged).

## Tests

- `packages/runtime/test/knowledge/apply-ops.test.ts`: reinforce caps, supersede links, duplicate detection, the
  5-op cap, the auto-correction confidence cap.
- `packages/runtime/test/knowledge/extraction-trigger.test.ts`: children never trigger; a turn start cancels a pending
  job; watermark advances only after a successful apply.
- `packages/runtime/test/agent/knowledge-nudge-hook.test.ts`: M0 cadence and reset on `update_knowledge`.
- `packages/evals`: precision of extracted entries on recorded sessions (human-labelled set) before enabling by default.
