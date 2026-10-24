# Evolve generated playtest harnesses incrementally

Evidence update (2026-10-07): this remains a design/history note. The
[PoC review](../review/autonomous-playtest-poc.md) records the latest saved
implementation and acceptance limits. In particular, the final grouped Horror
inspect path was not exercised by its last live run. Use the bundled skill and
product guide for current authoring instructions, not historical controller names.

Status: design direction for incremental improvement. The state-machine view is
a useful way to reason about behavior, not a mandatory framework or a decision
to implement a new Studio protocol. Preserve the working observe/input path.

## Start from what already works

Diligent has already generated game-specific Luau that physically aims, moves,
opens the right furniture, collects resources and deposits them. Preserve those
working capabilities and their actual feedback checks. The apartment example
exposed two separate issues: the controller sometimes lost productive goals, and
its successful runs left no genuine choices for Laya. Neither issue alone proves
that the whole runtime needs replacement.

The intended improvement is practical: Diligent reads the current game's code,
builds an editable harness suited to that game, and adjusts it from real results.
The model's role should be explicit and useful. State, transitions and event
consumption describe that behavior; a few functions and a small memory table may
be the best implementation.

## The natural division of responsibility

| Responsibility | Small implementation that is usually sufficient |
| --- | --- |
| Read game facts | Existing snapshot/event subscriptions and a few live bindings. |
| Remember useful context | Current objective/target plus bounded visit/failure history, if needed. |
| Produce executable behavior | Parameterized functions for approach, interact, return or recover. |
| Offer a real decision | Keep a few materially different legal alternatives for the model. |
| Adjust behavior | A small PolicyConfig with justified thresholds/preferences and units. |
| Advance state | Consume new correlated feedback once; verify actual effects. |

These are responsibilities, not six mandatory files/classes. Keep an existing
clear control flow. Add explicit phases when they clarify which actions are
legal or why a target is retained; do not convert every condition into an event
or build a state graph merely to match a template.

Game laws and eligibility remain hard guards. Preferences such as distance,
risk, novelty and returning early can remain adjustable and visible in model
context. Avoid turning all preferences into hard filters that leave the model
only a predetermined answer. Conversely, do not invent duplicate options or
model calls for an already forced execution step.

## Recommended next changes, one at a time

1. Identify one useful decision in the working game controller that code currently
   preselects. It may be a target, local route, timing or tactic; it need not be
   every high-level decision in the game.
2. Preserve the existing physical executors. Generate a few parameterized legal
   alternatives and expose their actual tradeoffs in compact state/descriptions.
3. Use the current Laya -> input batch -> observed game feedback path where the
   choice has a useful, observable result. Continue deterministic local execution
   where that is appropriate. Do not guess the selected option from publication.
4. Compare a bounded real run with the working baseline: actual objective progress,
   failures, repeated waits, useful model choices and latency. Use decisionEvidence
   and the actual candidate/choice/effect trace, not model-call count alone.
5. Keep the change only if it improves the requested behavior or resolves a
   demonstrated problem. Add more controller structure only when another concrete
   case needs it.

For the apartment, existing touch aiming, prompt hold handling, drawer binding,
modal avoidance and offloading remain useful. Target memory, new-route milestones
for the watchdog and a clear model decision point are better first changes than
replacing these with a generalized planner. All map-specific facts belong in that
harness and must be derived again for a different UGC project.

## Implemented small extension: runner-owned intent memory

On 2026-10-06, the runner gained optional action.intent metadata. Each frame
provides one current physical step per available goal. Laya chooses goal IDs;
the runner retains that ID and the selection-time state while dispatching its
changing input steps. No new Studio RPC, event bus or Lua callback is needed.

The goal's completeWhen predicates establish observed completion. Disappearance
or changed validity/completion meaning invalidates it. With alternatives present,
the model periodically chooses whether to continue or switch (default 2000 ms at
input boundaries, configurable). Continuing preserves the baseline and age, and
selection never resets the no-progress watchdog. The model receives active-goal
context separately from game facts.

The adapter computes each goal's next step from observed facts with goal-local
caches. It must not update a global selected target while enumerating alternatives.
Its Lua-private state still cannot consume a model-choice callback. Only that
separate requirement would justify a new receipt channel. The old mailbox sketch
in scripts/jev-playtest-poc/evidence/controller-design/receipt-protocol-sketch.txt
remains historical and unimplemented.

Automated regressions verify goal retention across changing step IDs, immediate
reselection after changed validity, periodic switching, and no-progress termination
despite repeated choices. These are runtime tests with controlled observations and
choices, not evidence of live Laya quality or a successful game run. Actual game
adapters must be authored with the metadata and verified against the current world.

## Scope and acceptance

The refined direction is exploration through gameplay, not only successful
scripted traversal. Diligent should generate game bindings, observations, controls
and result checks while leaving the intended navigation and play decisions to the
runtime model. Direct controls and bounded assists can share ordinary candidates;
intent remains optional for deliberate commitment. Fixed routes and hidden game
knowledge must not silently substitute for the decisions being tested.

Users adjust two independent axes through Diligent: implemented control assists,
and test objectives/constraints/budgets. Keep supported values explicit in the
game's editable configuration and use existing run arguments for episode limits.
This authoring workflow does not introduce a global difficulty setting or change
game rules. Existing installed adapters still need the corresponding capabilities;
guidance alone does not retrofit them. Report the observation/assistance conditions
with results and do not equate an automated player with validated human behavior.

The immediate scope is authoring guidance and small evidence-driven harness
improvements using current capabilities. A long-lived episode, hot reload,
multiple controllers, visual perception or a semantic receipt protocol should be
separate changes justified by observed need. The current 180-second episode limit
and live-progress reset remain known constraints on a full-clear objective.

Success means the generated harness preserves working behavior, allows genuine
model decisions where useful, verifies effects, and remains understandable for
Diligent's next repair. A narrow test can legitimately remain deterministic. A
request to demonstrate model-mediated play still needs an actual meaningful
model choice and its result; automatic-only success must be reported as such.
