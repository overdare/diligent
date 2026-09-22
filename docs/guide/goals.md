# Goal mode

Goal mode continues a root thread toward an explicit user objective. The runtime
stores the objective and limits, starts another agent run when needed, and stops
at completion, a pause, a limit, or a genuine blocker. It does not require a
separate manager model, worker model, or evaluator. Existing tools, permission
checks, and optional subagents still do the work.

## Enable and use

Goal mode is opt-in. Add this to your Diligent configuration and reload it:

```json
{
  "goals": { "enabled": true, "defaultMaxTurns": 20 }
}
```

Web and TUI share the same commands and protocol:

```text
/goal set Fix the failing auth tests and verify the result --turns 12 --tokens 50000
/goal
/goal pause
/goal edit Fix the auth tests and run the complete auth suite --turns 30 --tokens 100000
/goal resume
/goal clear
```

`/goal <objective>` is shorthand for `set`. Use explicit `set` when an objective
starts with a reserved action such as `pause` or `status`. Limits are positive
safe integers; the objective supports at most 4,000 Unicode code points.
Without `--tokens`, there is no token cap. Without `--turns`, the configured
maximum (20 when unspecified) applies. A turn here means an **outer agent run**,
which can include multiple model/tool rounds, not one API request or tool call.

Set/resume starts automatically when the root thread is idle and outside plan
mode. Set/edit/resume rejects while execution or its cleanup is in flight.
Pause before editing; edits retain accumulated usage. Increase an exhausted
limit before resuming. Omitted edit limits retain their previous values. Clear
the old goal or finish it before setting a replacement. Completed goals cannot
be edited; set a new goal with fresh counters instead. No command expands the
agent's authority, answers permission prompts automatically, or starts goals in
child sessions.

Stop pauses an active goal even between runs. A new ordinary user turn pauses
the goal with reason `user_turn`, giving the user priority. Plan mode, configuration
reload, host shutdown, or losing all connected clients also pauses
goal work. Resume is explicit; reconnecting or reading history never starts it.
If owned work is still cleaning up, configuration reload or an agent-rebuilding
mode/model change rejects without dropping that work's registry. Retry after
cleanup. Settings saved before a reload failure remain on disk and are applied
by the next successful reload.

## Success, failures, and recovery

The working model checks results and calls `update_goal` with `complete` and
non-empty evidence, or `blocked` and an unavoidable blocking reason. The runtime
checks ownership, current execution, and that goal-owned children have settled
before accepting completion. Evidence is the model's assessment, not an
independent proof or a second model's verdict. The model cannot create goals,
resume them, or change their limits.

Ordinary tool errors and failed tests remain inputs to the model, so it can
diagnose and retry. After the provider's existing retry mechanism is exhausted,
structured retryable network/server/rate-limit failures receive up to three
additional goal-level retries with backoff (up to 60 seconds per retry).
Provider usage/quota exhaustion becomes `usage_limited`, not an automatic retry.
Other unrecoverable run failures become `blocked`. Three consecutive tool-free
runs with no active owned child become `blocked: no_progress`. A successful run
resets the transient retry streak; explicit resume resets both streaks.

States are `active`, `paused`, `blocked`, `budget_limited`, `usage_limited`, and
`complete`. These distinguish a recoverable pause from achievement; no separate
terminal `failed` state is needed. Process recovery converts a persisted active
goal to `paused: restart`. A goal does not run while the app is closed.

## Usage and safety boundaries

The token meter counts provider-reported normalized fresh input, cache writes,
and output for the root and goal-owned descendants. Cached input reads are
displayed separately and excluded from the cap. Compaction-only calls and
failed requests without reported usage are not included. This is not a billing
meter. A sampled response may exceed the remaining cap; the runtime aborts
before dispatching its tool batch and cancels owned descendants. It cannot
undo external effects already performed or stop a third-party tool that ignores
cancellation.

Usage events retain the original goal, execution epoch, outer run, session, and
core turn identity, plus a unique execution identity when a child is resumed.
Replay deduplicates them, including late child usage, and
never transfers an old goal's spend to a replacement. Active time measures root
run elapsed time (including waiting inside a run), not the sum of child times
or idle backoff. Normal user work and unrelated children are not charged.

## Persistence and protocol

The append-only ledger is `.diligent/sessions/goals/<sessionId>.jsonl`. It is
separate from the conversation/compaction tree and contains snapshots, usage
identities, and clear tombstones. An incomplete final record is discarded on
recovery; malformed complete records fail closed. Deleting a thread removes its
goal ledger. One running app-server owns a session; concurrent processes writing
the same session are not supported.

- `thread/goal/get`: `{ threadId }` → `{ goal, sequence }`.
- `thread/goal/set`: `{ threadId, action, ... }` → the same snapshot.
- `thread/goal/updated`: `{ threadId, goal, sequence }` notification.
- `thread/read`: includes `goal` and `goalSequence`.

Controls other than `set` require `expectedGoalId` and `expectedRevision`.
Replacing a completed goal with `set` requires its current `expectedRevision`.
Clients refresh after a
conflict and ignore older sequence numbers. `capabilities.goals` advertises
protocol support, independently of whether the configuration enables creation.
Older peers may omit this capability.

Automatic input is persisted with `visibility: internal` and `source: goal`.
It bypasses slash-skill rewriting and `UserPromptSubmit`, does not fabricate a
user chat bubble, and retains normal Stop hooks. The current goal is injected at
run start and again after compaction. Root-only `get_goal`/`update_goal` tools
are never inherited by nested subagents.
