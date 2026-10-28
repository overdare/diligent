# Goal mode

Goal mode continues a root thread toward an explicit user objective. The runtime
stores the objective and limits, starts another agent run when needed, and stops
at completion, a pause, a limit, or a genuine blocker. It does not require a
separate manager model, worker model, or evaluator. Existing tools, permission
checks, and optional subagents still do the work.

## Start a goal

Goal support is enabled by default; no configuration is required. To disable
creation and automatic execution, set `goals.enabled` to `false` and reload.
Goals have no implicit run-count or token limit. To explicitly apply a default
outer-run limit to newly created goals, configure:

```json
{
  "goals": { "defaultMaxTurns": 20 }
}
```

Web and TUI share the same commands and protocol:

```text
/goal set Fix the failing auth tests and verify the result --turns 12 --tokens 50000
/goal
/goal pause
/goal edit Fix the auth tests and run the complete auth suite --turns 30 --tokens 100000
/goal edit Fix the auth tests and run the complete auth suite --turns unlimited
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

`create_goal` returns a **pending** request. The model should call it early and
finish its current reply. Only after that user turn and its session writes finish
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
otherwise only an explicitly configured default maximum applies. Default-enabled support does
not turn every normal chat message into persistent work.

`/goal <objective>` is shorthand for `set`. Use explicit `set` when an objective
starts with a reserved action such as `pause` or `status`. Limits are positive
safe integers; the objective supports at most 4,000 Unicode code points.
Without `--tokens`, there is no token cap. Without `--turns`, the configured
maximum applies if configured; otherwise runs are unlimited. `--turns unlimited`
explicitly removes a run cap, including a configured default. A turn here means an **outer agent run**,
which can include multiple model/tool rounds, not one API request or tool call.

Set/resume starts automatically when the root thread is idle and outside plan
mode. Set/edit/resume rejects while execution or its cleanup is in flight.
Pause before editing; edits retain accumulated usage. Increase an exhausted
limit before resuming, or remove the run cap with `edit <objective> --turns unlimited`.
Existing ledgers retain their numeric limits and usage: older implicit limits cannot
be distinguished from limits users explicitly requested. Omitted edit limits retain their previous values. Clear
the old goal or finish it before setting a replacement. Completed goals cannot
be edited; set a new goal with fresh counters instead. No command expands the
agent's authority, answers permission prompts automatically, or starts goals in
child sessions.

Stop pauses an active goal even between runs. The model can also honor an explicit
natural-language request to pause or stop using `update_goal` with `paused`;
instructions forbid model-initiated pauses. Use `/goal pause` for a direct runtime pause.
A new ordinary user turn takes
priority over the current run, cancels its outstanding work, and continues under
the same active goal, including its accounting and limits. Steering also preserves
the active goal. Plan mode, configuration reload, and host shutdown pause goal work.
Losing the last client connection does not pause a goal: the current run can finish,
but admission of another automatic run waits for a client to reconnect. Pending
goal approvals and questions survive disconnect and are redelivered on subscription;
missing clients never grant permission. Explicitly paused goals stay paused across
reconnect and history reads. Process restart still requires explicit resume.
Manual context compaction releases the thread back to the goal scheduler when it
finishes, even when compaction is skipped or fails; an explicit pause still wins.
If owned work is still cleaning up, configuration reload or an agent-rebuilding
mode/model change rejects without dropping that work's registry. Retry after
cleanup. Settings saved before a reload failure remain on disk and are applied
by the next successful reload.

## Success, failures, and recovery

The working model checks results and calls `update_goal` with `complete` and
non-empty evidence, or `blocked` and an unavoidable blocking reason. Instructions
require a requirement-by-requirement completion audit and the same blocker across
at least three consecutive goal runs with no safe next action. The runtime rejects
blocked reports before three runs since creation, resume, or user replacement;
equivalence of blockers and the availability of alternatives remain model assessments.
The runtime
checks ownership, current execution, and that goal-owned children have settled
before accepting completion. Evidence is the model's assessment, not an
independent proof or a second model's verdict. Beyond explicit-request creation,
the model cannot edit goals, resume them, or change their limits.

Ordinary tool errors and failed tests remain inputs to the model, so it can
diagnose and retry. After the provider's existing retry mechanism is exhausted,
structured retryable network/server/rate-limit failures receive up to three
additional goal-level retries with backoff (up to 60 seconds per retry).
Provider usage/quota exhaustion becomes `usage_limited`, not an automatic retry.
Other unrecoverable run failures become `blocked`. Three consecutive empty
runs with no activity or active owned child become `blocked: no_progress`.
Nonempty assistant text, thinking, tools, steering, and compaction count as activity;
the guard does not equate absence of tool calls with absence of progress. A successful run
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
or idle backoff. User follow-ups while a goal is active are goal-owned; ordinary
work outside active goals and unrelated children are not charged.

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
run start and again after compaction. Root-only `create_goal`/`get_goal`/`update_goal` tools
are never inherited by nested subagents.
