# Goal mode

Goal mode continues a root thread toward an explicit user objective. The runtime
stores the objective and limits, starts another agent run when needed, and stops
at completion, a pause, a limit, or a genuine blocker. It does not require a
separate manager model, worker model, or evaluator. Existing tools, permission
checks, and optional subagents still do the work.

## Start a goal

Goal support is enabled by default; no configuration is required. To disable
creation and automatic execution, set `goals.enabled` to `false` and reload.
Goals have no run limit by default; a goal keeps working until it is complete,
blocked, paused, or out of token budget. `goals.defaultMaxTurns` optionally sets
a default run limit for new goals.

Web and TUI share the same commands and protocol:

```text
/goal set Fix the failing auth tests and verify the result --tokens 50000
/goal
/goal pause
/goal edit Fix the auth tests and run the complete auth suite --tokens 100000
/goal edit --tokens off --runs 30
/goal resume
/goal clear
```

You can also explicitly request persistent work in a normal message, for example:
"Keep working until the failing auth tests pass and the fix is verified."
The main model can then call `create_goal`; no separate intent classifier or
manager model is involved. Its tool instructions limit creation to explicit user
requests to persist until a clear end condition, not ordinary tasks, questions,
or instructions quoted in retrieved content. This is model-guided interpretation,
not a deterministic guarantee that every phrase will be classified correctly.
Use `/goal set` when you want an explicit, deterministic start.

`create_goal` returns a **pending** request. The model calls it as its first
action, and the current reply ends as soon as the request is accepted; the work
itself happens in goal runs. Only after that user turn and its session writes finish
successfully does the runtime persist the goal, publish the shared status, and
schedule its first automatic run. The originating user turn is not goal-owned:
its tokens, time, and children are outside the new goal's accounting. A crash,
Stop, failed turn, new user admission/steering, goal-control request, mode/model/
effort change, settings mutation/reload, thread deletion request, shutdown, or originating-client disconnect
discards the pending request.
Pending requests are not durable and cannot restart after reconnect/recovery.

The runtime accepts creation only in a current root user turn, outside plan mode
and with the feature enabled. It rejects duplicate pending requests and creation
when any goal already exists, including a completed one. Manage existing goals
through `/goal`; automatic continuations and child agents cannot create goals.
The model must pass `tokenBudget`/`maxTurns` only if the user specified those limits;
otherwise there is no token budget and no run limit unless `goals.defaultMaxTurns` is set. Default-enabled support does
not turn every normal chat message into persistent work.

`/goal <objective>` is shorthand for `set`. Use explicit `set` when an objective
starts with a reserved action such as `pause` or `status`. Limits are positive
safe integers; the objective supports at most 4,000 Unicode code points.
Without `--tokens`, there is no token cap. Without `--runs`, there is no run
limit unless `goals.defaultMaxTurns` is configured. A run is one **outer agent run**,
which can include multiple model/tool rounds, not one API request or tool call.
Status displays elapsed active time, tokens, and runs; the run count is shown
against a limit only when one is set.

Set/resume starts automatically when the root thread is idle and outside plan
mode. Set/edit/resume rejects while execution or its cleanup is in flight.
Pause before editing; edits retain accumulated usage. Increase an exhausted
limit before resuming. Omitted edit limits retain their previous values, `off`
removes a limit (`/goal edit --runs off`), and the objective may be omitted when
only limits change. Changing the objective restarts the blocked audit, and the
next run is told that the objective was edited. Clear
the old goal or finish it before setting a replacement. Completed goals cannot
be edited; set a new goal with fresh counters instead. No command expands the
agent's authority, answers permission prompts automatically, or starts goals in
child sessions.

Stop pauses an active goal even between runs (reason `user`), and only an
explicit resume restarts it. A new ordinary user turn suspends the goal with
reason `user_turn`, giving the user priority; the model sees a short note about
the suspended goal. When that reply finishes successfully, the goal resumes
automatically. It stays paused if the reply fails or is stopped, if the user asks
the model to pause the goal, if goals were disabled or plan mode was entered, or
if the goal was changed meanwhile. Steering a running goal run goes into that run
and does not pause the goal. A configuration reload pauses with
`config_reload` and resumes after the reload succeeds; a failed reload leaves the
goal paused.

When the last client disconnects, goal work keeps going for a 2-minute grace
period, but no new goal run starts until a client reconnects; reconnecting wakes
the goal. If nobody reconnects in time, the goal pauses as `disconnected`.
Approvals and questions from goal-owned work never resolve without a client: they
pause the goal as `interaction_unavailable` and fail closed. Plan mode, host
shutdown, restart recovery, disconnect expiry, runtime or persistence errors, and
model-requested pauses all require an explicit resume.
If owned work is still cleaning up, configuration reload or an agent-rebuilding
mode/model change rejects without dropping that work's registry. Retry after
cleanup. Settings saved before a reload failure remain on disk and are applied
by the next successful reload.

## Success, failures, and recovery

Each goal run starts from a continuation prompt that restates the objective as
escaped user data, the current usage, and the completion and blocked audits. The
working model checks results and calls `update_goal` with `complete` and
non-empty evidence, or `blocked` and an unavoidable blocking reason. The runtime
checks ownership, current execution, and that goal-owned children have settled
before accepting completion. It also rejects `complete` unless the current run
has made at least one tool call other than `get_goal`, `update_goal`, and `plan`,
and rejects `blocked` before the third consecutive run since the goal was last
started, edited, or resumed. Evidence is the model's assessment, not an
independent proof or a second model's verdict. The model can report `paused`
only when the user asks to pause the goal, including from an ordinary user turn.
Beyond explicit-request creation, the model cannot edit goals, resume them, or
change their limits.

Ordinary tool errors and failed tests remain inputs to the model, so it can
diagnose and retry. After the provider's existing retry mechanism is exhausted,
structured retryable network/server/rate-limit failures receive up to three
additional goal-level retries with backoff (up to 60 seconds per retry).
Provider usage/quota exhaustion becomes `usage_limited`, not an automatic retry.
Other unrecoverable run failures become `blocked`. Three consecutive runs that
make no tool calls other than `get_goal`, `update_goal`, and `plan`, with no active
owned child, become `blocked`. The reason is the last rejected blocked claim if the
model made one, and `no_progress` otherwise. A successful run resets the transient
retry streak; explicit resume resets both streaks.

States are `active`, `paused`, `blocked`, `budget_limited`, `usage_limited`, and
`complete`. These distinguish a recoverable pause from achievement; no separate
terminal `failed` state is needed. Process recovery converts a persisted active
goal to `paused: restart`. A goal does not run while the app is closed.

## Usage and safety boundaries

The token meter counts provider-reported normalized fresh input, cache writes,
and output for the root and goal-owned descendants. Cached input reads are
displayed separately and excluded from the cap. Compaction-only calls and
failed requests without reported usage are not included. This is not a billing
meter. The budget is soft: a sampled response may exceed the remaining cap. When
it does, the runtime marks the goal `budget_limited`, stops that response's tool
batch before dispatch, and cancels owned descendants. The run then gets one
text-only wrap-up reply that summarizes progress and the next step; tool calls
after the crossing never run, and if the model asks for tools again the run ends.
Completion cannot be reported after the budget is exhausted. The runtime cannot
undo external effects already performed or stop a third-party tool that ignores
cancellation.

Usage events retain the original goal, execution epoch, outer run, session, and
core turn identity, plus a unique execution identity when a child is resumed.
Replay deduplicates them, including late child usage, and
never transfers an old goal's spend to a replacement. Active time measures root
run elapsed time (including waiting inside a run), not the sum of child times
or idle backoff. Normal user work, including ordinary user turns while a goal is suspended, and
unrelated children are not charged.

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

`maxTurns` (the run limit) is optional, and `turnsUsed` counts goal runs; the
field names are kept for compatibility. `runStartedAt` is present while a goal run
is in flight so clients can tick elapsed time live. `edit` accepts `null` for
`tokenBudget` or `maxTurns` to remove a limit, and may omit the objective. Old
ledgers, including goals stored with the former default of 20 runs, still load
unchanged; an older runtime cannot read a ledger whose goal has no run limit.

Controls other than `set` require `expectedGoalId` and `expectedRevision`.
Replacing a completed goal with `set` requires its current `expectedRevision`.
Clients refresh after a
conflict and ignore older sequence numbers. `capabilities.goals` advertises
protocol support, independently of whether the configuration enables creation.
Older peers may omit this capability.

Automatic input is persisted with `visibility: internal` and `source: goal`.
It bypasses slash-skill rewriting and `UserPromptSubmit`, does not fabricate a
user chat bubble, and retains normal Stop hooks. The goal run's input is the continuation prompt; it is
restated after compaction, and the budget wrap-up prompt is injected before the
sample that follows a budget crossing. Ordinary user turns while a goal is
suspended get a short note on their first sample and after compaction. Root-only `create_goal`/`get_goal`/`update_goal` tools
are never inherited by nested subagents.
