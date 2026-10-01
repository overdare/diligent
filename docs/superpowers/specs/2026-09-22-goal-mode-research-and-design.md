# Goal Mode: Research and Proposed Design

Date: 2026-09-22. Status: implemented under OVDR-15262; historical research and design.
See [Goal mode](../../guide/goals.md) for the current usage contract and
[implementation record](../plans/2026-09-22-goal-mode.md#implementation-record-2026-09-22)
for delivery differences and remaining rollout validation.

Research baselines: Diligent `fa3a87117a95`; OpenAI Codex public `main` at
`639d2478cc2e16d6ca715952d2e726a3aecc024e` (2026-09-22). Codex source was cloned
and inspected locally, including its tests. A current main checkout is not evidence
that every released desktop or CLI build already contains the same implementation.

## What the feature does

A goal keeps an objective active across multiple outer agent runs. A normal run can
finish after the model produces an answer without tool calls. Goal mode decides
whether to start another run, preserving the objective until completion, interruption,
a limit, or a blocking condition. It is distinct from a task checklist, one model's
reasoning effort, automatic tool approval, a periodic `/loop`, and a background daemon.

There are two useful levels of iteration: provider sampling/tool rounds inside one
run, and automatic continuation across runs. The latter is the essential addition.

## Claude Code: documented behavior, not inspected private implementation

Claude documents `/goal` as a session-scoped prompt Stop hook. A separate small model
evaluates the condition against conversation evidence; it cannot independently inspect
files or execute tests. Its verdict is met, not met, or impossible. A not-met reason
guides another turn. One condition is active, and `/goal clear` removes it. Active
conditions restore on resume, while the timer, turn count, and spend baseline reset.
Background tasks defer evaluation; repeated tool-free turns can stop continuation.
Permission policy remains unchanged. These are documented contracts, not claims about
unpublished function names or an independently verified implementation.
[Official goal documentation](https://code.claude.com/docs/en/goal).

The public hook contract explains the mechanism: a prompt handler returns structured
`ok`, `reason`, and optional `impossible` fields. A Stop handler can prevent normal
termination and feed its reason back into the conversation. User interrupts and API
failures have different lifecycle handling. The general hook protection of eight
consecutive blocks must not be assumed to be the built-in goal feature's exact cap.
[Official hooks reference](https://code.claude.com/docs/en/hooks#prompt-based-hooks).

The public `anthropics/claude-code` repository provides documentation, issues, release
material, and extensions; it does not provide the goal engine source inspected here.
[Public repository](https://github.com/anthropics/claude-code).

## Codex: source-backed implementation

The user commands set, view, edit, pause, resume, and clear a goal. Objectives have a
4,000-character bound. See the [official command reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli).
The [0.128.0 release](https://github.com/openai/codex/releases/tag/rust-v0.128.0)
also records persisted goal workflows. Current source paths have moved beyond older
search results that refer to `core/src/goals.rs` or `prompts/src/goals.rs`.

| Concern | Inspected source | What it implements |
| --- | --- | --- |
| User RPC | [thread_goal_processor.rs](https://github.com/openai/codex/blob/639d2478cc2e16d6ca715952d2e726a3aecc024e/codex-rs/app-server/src/request_processors/thread_goal_processor.rs#L126) | Feature/provider checks, set/get/clear, rollout persistence and ordered notifications |
| Lifecycle | [extension.rs](https://github.com/openai/codex/blob/639d2478cc2e16d6ca715952d2e726a3aecc024e/codex-rs/ext/goal/src/extension.rs#L301) | Thread resume/idle, turn start/stop/error, tool finish, token-usage integration |
| Continuation | [runtime.rs](https://github.com/openai/codex/blob/639d2478cc2e16d6ca715952d2e726a3aecc024e/codex-rs/ext/goal/src/runtime.rs#L425) | Serialized goal read/start, deferral checks, active-state check, start only if idle |
| Model controls | [tool.rs](https://github.com/openai/codex/blob/639d2478cc2e16d6ca715952d2e726a3aecc024e/codex-rs/ext/goal/src/tool.rs#L200) | `create_goal`, `get_goal`, `update_goal`; validation and restricted status changes |
| Prompt construction | [steering.rs](https://github.com/openai/codex/blob/639d2478cc2e16d6ca715952d2e726a3aecc024e/codex-rs/ext/goal/src/steering.rs) | Internal goal context, escaped objective, objective edits and budget wrap-up |
| Accounting | [accounting.rs](https://github.com/openai/codex/blob/639d2478cc2e16d6ca715952d2e726a3aecc024e/codex-rs/ext/goal/src/accounting.rs#L508) | Incremental usage, descendant roll-up, concurrent checkpoint exclusion, activity checks |
| Durable state | [goal migration](https://github.com/openai/codex/blob/639d2478cc2e16d6ca715952d2e726a3aecc024e/codex-rs/state/goals_migrations/0001_thread_goals.sql), [state runtime](https://github.com/openai/codex/blob/639d2478cc2e16d6ca715952d2e726a3aecc024e/codex-rs/state/src/runtime/goals.rs) | One goal per thread, stable goal identity, guarded updates, budget/status enforcement |
| Regression evidence | [backend tests](https://github.com/openai/codex/blob/639d2478cc2e16d6ca715952d2e726a3aecc024e/codex-rs/ext/goal/tests/goal_extension_backend.rs), [accounting tests](https://github.com/openai/codex/blob/639d2478cc2e16d6ca715952d2e726a3aecc024e/codex-rs/ext/goal/tests/accounting.rs) | Concurrent usage, descendant spend, errors, resume and invalid tool transitions |

The state machine contains `active`, `paused`, `blocked`, `usage_limited`,
`budget_limited`, and `complete`. The latest source stores goal records in a dedicated
`goals_1.sqlite` database and also records goal updates in rollouts. This is persistent
runtime state, not something reconstructed only from a model's summary.
[Database selection](https://github.com/openai/codex/blob/639d2478cc2e16d6ca715952d2e726a3aecc024e/codex-rs/state/src/sqlite.rs#L30).

The main execution path, simplified from the inspected code, is:

```text
user sets goal -> persist objective/status -> start if idle
  -> ordinary model/tool run -> account usage -> finish run
  -> idle lifecycle -> reread goal under lock
  -> active and admissible? inject internal objective/budget -> next run
  -> otherwise remain stopped
```

There is no separate semantic evaluator model in this inspected goal path. The worker
calls `update_goal` when it considers the objective complete. The continuation prompt
asks for requirement-by-requirement evidence, but the runtime does not prove that tests
cover every requirement. The same-blocker/three-turn rule is principally a model
instruction, distinct from deterministic empty-response and execution-failure guards.
[Continuation template](https://github.com/openai/codex/blob/639d2478cc2e16d6ca715952d2e726a3aecc024e/codex-rs/ext/goal/templates/goals/continuation.md),
[tool contract](https://github.com/openai/codex/blob/639d2478cc2e16d6ca715952d2e726a3aecc024e/codex-rs/ext/goal/src/spec.rs).

Codex charges uncached input plus output, using deltas rather than repeatedly summing
the transcript. Descendant usage rolls into the root. Budget crossing changes status
and can inject a wrap-up instruction during the current run; in-flight usage continues
to accrue. It is not an exact token-level hard kill. Errors escaping ordinary retries
block continuation; usage-limit errors have a distinct state. Goal identity checks and
serialization prevent a stale run from changing a replacement goal. Source links in
the table establish these details; they should be consulted instead of older tutorials.

## Diligent findings that affect the design

Paths below are relative to the repository root and refer to the research baseline.

| Existing implementation | Consequence |
| --- | --- |
| `packages/core/src/agent/loop.ts:174` emits usage per model sample; its loop finishes without tool calls or pending steering | Reuse the inner agent loop; add outer continuation |
| `packages/core/src/agent/loop-hooks.ts:44` exposes synchronous trusted hooks | Do not perform asynchronous evaluator calls in `afterTurn` |
| `packages/runtime/src/session/types.ts:184` defines result-ignoring `onStop`; `hooks/runner.ts` implements that contract | Do not change external Stop hooks into a restart mechanism |
| `packages/runtime/src/app-server/server.ts:352` waits for the run and session writes, then publishes completion | Add a shared runtime coordinator at this boundary, with an explicit outcome |
| `packages/runtime/src/session/turn-orchestrator.ts:334` records some run failures instead of rethrowing them | A resolved promise or `turn/completed` alone is insufficient evidence of success |
| `packages/runtime/src/app-server/turn-handlers.ts:193` reserves a run and waits behind `turnWork`; interrupt retires its ID before abort | Automatic admission must share the reservation path and recheck generation/goal identity |
| `packages/runtime/src/session/turn-stager.ts:24` captures a parent leaf before execution | Appending goal entries directly to the conversation tree mid-run risks an orphaned branch |
| `packages/runtime/src/session/persistence.ts:134` lists root `*.jsonl`; `sessions/` is ignored | A `sessions/goals/<sessionId>.jsonl` ledger is a small, compaction-independent persistence option |
| `packages/core/src/llm/provider/openai/responses.ts:315` already subtracts cache reads and writes from `inputTokens` | Goal charge should be `inputTokens + cacheWriteTokens + outputTokens`, not Codex's raw-provider formula |
| `packages/runtime/src/collab/registry.ts:457` sees child events; app-server forwarding detaches when the parent finishes | Account children through a durable-lifetime internal observer, not UI forwarding |
| `packages/runtime/src/app-server/server-requests.ts:80` supports indefinitely pending input; null approval responses can map to `once` | Goal cancellation needs typed abort handling, never a synthetic null approval |
| `packages/core/src/agent/tool.ts:47` starts the parallel branch without a pre-abort check | Add a generic preflight abort check before claiming budget/stop prevents the next tool batch |
| `packages/runtime/src/collab/registry.ts:57` inherits parent tool objects | Filter root-only goal tools so children cannot invoke a closure that controls the parent's goal |
| `ARCHITECTURE.md` requires shared runtime/protocol and thin clients | Deliver Web and TUI together |

No persistent goal feature was found. The plan-reminder hook only reinjects unfinished
checklist context; it neither stores a goal lifecycle nor starts another outer run.

## Recommended MVP contract

Use a Codex-style runtime state machine. Defer a Claude-style independent evaluator to
a separately selectable follow-up. This reuses Diligent's multi-provider tool loop and
does not require a second configured model to deliver a useful first version.

1. One goal per root session. Creation is explicit through `/goal <objective>` or a
   typed RPC. Child agents do not create independent automatic goals in the MVP.
2. `/goal` shows status; `pause`, `resume`, `clear`, and `edit <objective>` are reserved
   subcommands. `/goal set <objective>` allows objectives beginning with reserved words.
   Optional `--tokens N` and `--turns N` flags are accepted for set/edit; no shell evaluation.
3. Creation on an idle execution-mode thread starts immediately. While a run is active,
   reject create/edit with a useful conflict response; pause/get/clear remain available.
   Editing requires an idle, non-active goal, retains spent usage, and invalidates stale work.
   A completed goal can be replaced with a new ID and fresh counters.
4. State: `active | paused | blocked | budget_limited | usage_limited | complete`.
   Clear records a tombstone. A reason explains a stop. Only explicit user controls can
   resume or increase limits. Completion and blocked reports are model tool operations.
5. `/goal pause`, UI Stop, and `turn/interrupt` pause the goal before aborting its work.
   They cancel owned pending questions and goal-owned descendants. Clear does the same
   and retains the history. No continuation after an interrupt or late tool result.
6. Permissions and mode remain authoritative. Plan mode cannot auto-start execution;
   switching an active goal to plan mode pauses it. Goal admission waits for pending
   approvals/questions and children; their completion signals wake the coordinator.
7. The host process must remain running. Reconnecting to that process preserves work.
   After a process restart, recover an active goal as paused with `restart` reason and
   require explicit resume. This is a deliberate MVP difference from automatic recovery.
   Opening or reading a historical session never starts work.
8. Budgets persist across resume/edit. Token budget is optional; a proposed default of
   20 goal-attributed outer runs bounds an otherwise unlimited MVP. Explicit `--turns`
   changes this cap. Do not confuse provider rounds with outer runs. Active work time is
   reported but is not a separate time-limit mechanism in this release.
9. Token limits cover reported regular assistant usage for root and descendants. Cached
   reads are displayed but excluded from the charged count. Unreported failed requests
   and current compaction calls are outside this accounting scope; the UI/docs must not
   describe it as an invoice or absolute spend cap. Budget checks stop further work at
   observable boundaries; already in-flight requests may overshoot. Native compaction
   currently has no usage field (`llm/provider/native-compaction.ts`).
10. The model gets `get_goal` and `update_goal`; no model `create_goal` in the MVP.
    `update_goal` accepts `complete` or `blocked` with a non-empty evidence/reason summary.
    Completion is a recorded model assessment, not proof from an independent evaluator.
11. Three consecutive automatic runs with no tool activity and no pending live child
    suspend continuation as `blocked/no_progress`. This is a narrow liveness guard,
    not a claim that tool use proves progress. Existing inner-loop detection remains.
12. Structured transient provider errors escaping core retries receive bounded,
    cancellable goal-level backoff (up to three retries); other provider errors block
    the goal and provider usage limits use `usage_limited`. Missing
    interactive approval/input consumers suspend automatic goal admission.

The user approved the default cap, pause-on-process-restart policy, deferred evaluator,
and bounded transient recovery on 2026-09-22. These are product choices, not existing behavior.

## Ownership, persistence, and concurrency

Add `runtime/src/goals/{store,controller,accounting,prompt,tools}.ts` and
`app-server/goal-handlers.ts`. `GoalController` owns decisions; existing app-server
turn machinery owns execution. The goal store has one serialized, append-only ledger
under `sessions/goals/`, independent of conversation `parentId`. Notifications derive
from successfully written snapshots. No SQLite or generic scheduler framework is needed.

A goal has a stable ID, control revision, execution epoch, objective, status, limits,
usage, outer-run count, reason, timestamps, and last completion evidence. A control
revision guards user edits; an execution epoch invalidates queued work on pause/clear,
resume, or replacement. Accounting updates do not invalidate a valid running epoch.
Ledger usage records use stable `(goalId, epoch, sessionId, outerRunId, coreTurnId)` keys.
Repeated delivery must not charge twice. Ledger replay must preserve deduplication.

Automatic work is admitted after the previous run, writes, and cleanup settle. Use
the same short critical section as user turn admission, never a lock held for the
duration of an LLM run. User input already queued has priority. Recheck state immediately
before reservation; only then increment outer-run count and start. Late callbacks may
record old spend but cannot change the new goal's state. A pending child completion
can wake this same path; it must not call a second independent restart function.

Internal continuation is persisted as an internal user-role context item with source
`goal`, using the existing visibility model, and gets a fresh goal snapshot after
compaction. It is not a fake user message or a new permission grant. Preserve ordinary
turn notifications and show a goal status indicator in both clients, including the
reason that a run resumed or stopped.

## Verification and follow-up

Deterministic tests should prove state, persistence, accounting, admission, cancellation,
and public protocol behavior. A scripted model saying complete only proves tool/state
propagation, never real goal satisfaction. Live-model evals separately measure premature
completion, unnecessary continuation, no-progress loops, usage, and success on task
worlds with external acceptance checks.

The next stage can add an optional independent evaluator with a provider-scoped
`ModelRef`, structured `met | continue | blocked` result, timeout/abort, and accounted
usage. It should consume captured evidence, state its lack of independent inspection,
and never turn an evaluator failure into success. Deterministic acceptance commands
can follow later, with the existing permissions and cwd rules, not arbitrary execution
from an untrusted goal string. Neither feature is required for the MVP.

See [the implementation plan](../plans/2026-09-22-goal-mode.md) for file-level tasks,
interfaces, tests, and delivery order.
