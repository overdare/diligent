# Generate a controller that leaves meaningful decisions to the model

Use this reference to clarify decisions in a complex harness. The state-machine
view is a design aid, not a required framework. Preserve working behavior and add
structure only where it solves an observed problem. These are internal code
responsibilities, not additional tool APIs. Plain Luau tables and functions may
be sufficient; use an existing state library only after verifying its real API.

## Two loops with different responsibilities

Diligent's authoring loop reads game code/GUI, identifies useful observations and
controls, writes the controller, validates it, inspects a bounded real run and
repairs the responsible code between runs. Dynamic harness generation means this
project-specific implementation can evolve. It does not mean generating new Lua
for every gameplay decision or replacing the game's own rules.

The gameplay loop is observed facts/events -> controller state -> legal action
alternatives -> model choice -> fresh validation -> physical input -> observed
results. A game-state change and an internal controller-state change are distinct.
Selecting a pickup never means inventory already increased.

For structured observations without vision, spatial and local interaction
transitions are often a useful choice boundary. Represent current space, object
states and player resources as facts. Offer guarded events such as enter(section),
approach(drawer), open(drawer), collect(visible item) or leave(section). Each event
has an executor and an observed completion predicate. Navigation/aiming can execute
a chosen transition; selecting the next section or local interaction remains with
the model. If target selection is the decision under test, an inspect(target)
intent can span approach, focus and confirmed opening. If focus selection itself
is under test, keep it separate. Do not automatically chain inspection, collection
and delivery into a winning itinerary. Conversely, reducing the whole policy to raw
movement/rotation is not required for autonomy and may discard useful game state.
Plain tables and functions are sufficient; a state-machine library is optional.

A witnessed transition should update the current stage and local objective as
well as the candidate catalog. For example: entering a room -> bounded loading ->
inspect this room; a revealed item -> collect or continue searching; full inventory
-> return/deposit context. Keep the user's overall objective, and pass the current
local objective in compact decision state. The model chooses among meaningful
events within that context, including leaving or interrupting when appropriate.
Changing buttons while repeatedly supplying only the global objective is not the
same as maintaining this controller state. Hierarchical scope can make the model's
role clear: local actions/leave inside a room, next-section selection in the hall.

Check what each game event actually means. A room-stream selection can precede
physical arrival; it must not complete an enter-room transition on its own. Use
the relevant geometry/arrival evidence and a bounded content-loading state before
interpreting temporarily missing interactions as an empty room or forcing an exit.

For exploratory player simulation, the policy should discover routes, choose
actions and respond to failed attempts. More model calls or smaller actions do
not by themselves prove autonomy. Define the decisions under test: a navigation
test needs route choices, while a tactical test may deliberately use a movement
helper. Treat observed detours and failures as evidence, not reasons to inject a
known winning route. This is an automated player, not validated human behavior.

## Adjustable controls and test conditions

Use two independent sets of settings in the editable adapter, with existing tool
run arguments for episode limits. The following are examples to derive from this
game, not new tool fields or a required global profile registry:

| User request | Configuration and behavior to change |
| --- | --- |
| Choose spatial and room-local transitions | Offer meaningful section/target/local-action alternatives; retain a selected target's mechanical substeps where appropriate. |
| Let the model move and look directly | Offer bounded camera-relative movement and view changes; disable automatic approach/aim assists. |
| Help with aim, but let it choose the route | Enable view alignment to a model-selected observed target; retain movement alternatives. |
| Use short approach helpers too | Add a bounded approach action alongside direct controls; expose its target and stop boundary. |
| Explore before trying to clear | Change the test objective and observed exploration criteria; keep game win evidence separate. |
| Survive for a specified interval or avoid a resource | Set the test condition and budget; implement an observable check or declared action restriction where enforceable. |

Implement only the settings needed for this game/test in a small readable table,
such as ControlConfig and TestConfig. Every advertised setting must actually be
consumed by candidate generation, execution or an outcome check. Do not call a
prompt preference an enforced restriction. Preserve these settings across
repairs; record the applied configuration and source hash with the result.
Users can request changes in conversation: Diligent reads the current source,
updates supported values with expectedSourceHash, validates and uses matching
run goal/time arguments. A new setting may require implementation first. Do not
claim configuration support in an older installed adapter just because this
guide describes it. A separate settings UI is not required by this workflow.

Changing assistance does not change HP, damage, enemy behavior or game win rules.
Changing the test objective does not make partial progress a full game clear.
Describe the tested condition and the actual game outcome separately.

## Separate the parts that change for different reasons

| Responsibility | What Diligent derives | What it must preserve |
| --- | --- | --- |
| Bindings | Snapshot sources, GUI/prompt paths, input routes, geometry | Authoritative facts, freshness, unknowns |
| Controller state and event reducer | Mode, retained objective/target, lifecycle generation, observed progress | Correlated events consumed once; reset/interrupt rules |
| Parameterized capabilities | Move(direction), look(delta), interact(prompt), optional approach(target) | Legal guards, balanced bounded inputs, actual effect predicates |
| Decision points | Genuine target, route, timing or tactic alternatives | Laya has materially different feasible options |
| Editable test/control configuration | Assistance, observation scope, objective, budgets, supported restrictions | Implemented behavior and units; gameplay limits remain facts |

Keep only the responsibilities the current harness needs, legible within its
existing code. Split files or introduce explicit phases only when that improves
maintenance; no capability registry or formal graph is required. Avoid a chain of wrappers that depend on another driver's
side effects. Bind world-specific positions and IDs once from source/scene data,
then pass them as parameters instead of duplicating routes in every branch.

## Define transitions before writing a long observe function

Where an explicit transition is useful, identify its current mode, observed trigger, guard,
available actions, completion evidence, next mode and failure/timeout path. For
example, a collection game may have exploring, approaching, interacting,
returning, avoiding danger and recovery modes. These are examples, not a required
state catalog for every UGC game.

Reduce accepted snapshots, room-entry/interaction feedback, GUI changes and
bounded deadlines into controller state. Correlate by player, target, generation
and event/revision ID. Repeated observe calls or repeated snapshot publication
must not consume the same event again. Keep candidate construction free of game
mutations and do not commit to a candidate merely because it was offered.

Retain a confirmed target through a deliberately bounded assisted execution phase. Reconsider at meaningful
boundaries: arrival, objective completion, vanished target, changed danger,
failed effect or expired recovery budget. Low-level aiming, approaching a chosen
object and honoring its prompt hold time can be deterministic when that fits the
selected assistance. Explicitly bound
their execution so a new hazard can be handled at the next supported boundary.

Do not conflate executor outcomes. No immediate input may mean completion,
an observed animation still running, a blocked target needing recovery, or an
invalid target. Silently omitting a still-valid intent whenever its step helper
returns nil can cause repeated policy reselection. Supply a bounded wait only
for an evidenced pending condition, expose recovery for a blockage, and invalidate
for genuine loss of availability. Keep goal ID, validity and completion meaning
stable across approach/focus/input phases. See [interaction-state.md](interaction-state.md)
for target mapping and completion evidence; this is not a new runner status API.

## Preserve decision freedom

Hard guards remove impossible actions: a missing target, full inventory, unavailable
control, or an unmet game prerequisite. Preferences describe tradeoffs among
possible actions: nearer versus unexplored rooms, further collection versus an
early delivery, or alternate escape routes. Do not implement every preference as
an if/else that removes the other feasible choice.

Legal is not synonymous with safe or optimal. When testing exploration and
recovery, do not use privileged hazard knowledge to remove every action that could
fail. Expose known risk to the policy, and make any requested safety assistance
explicit. A controller that prevents every mistake cannot reveal the same
navigation, discoverability or recovery problems as one making those choices.

Generate instances of capabilities from current facts. Supply compact descriptions
and state with the distinctions needed to choose: distance, capacity, known risk,
expected progress, visit history and recent failures. Unknown risk stays unknown.
If the catalog needs bounding, retain useful diversity within the tool/model
limits instead of taking only the highest-scored option. Equivalent renamed
actions are not decision diversity.

In a collection game, two reachable unvisited rooms are a target decision; a
partly loaded player with both a reachable item and reachable deposit may face a
collection/delivery decision. In a direct-control exploration test, turning,
moving around a blocker and choosing whether to interact are also model decisions.
Do not collapse those into an assisted route merely to reduce inference calls.
A narrow user-requested mechanic test may legitimately never reach a model
decision; report that scope.

Direct control requires useful perception, not just a list of keys. Derive
camera-relative openings/blockers, visible or previously discovered targets,
actual prompts/GUI and relevant resource state from supported observations.
Unknown or unloaded areas remain unknown. Privileged server facts may verify a
result without appearing in decisionState or candidate descriptions. Use compact
observed history so a model can distinguish a new attempt from repeatedly failing
at the same place. Increasing action frequency cannot substitute for these facts.

## Current transport boundary: do not invent a decision callback

The current driver invokes only start() and observe(). The runner sees the decision provider's
chosen action ID, revalidates it and sends the action's physical input events.
It does not deliver a semantic ChoiceAccepted callback to the Lua adapter.
Top-level frame events are diagnostic feedback logs; actions[].events are input
batches. Neither is a model-to-controller event bus. execute.luau is Editor-only.

For short choices, offer bounded executable alternatives and advance adapter state
from actual, distinguishable game feedback. For a goal spanning several steps,
use the implemented action.intent contract: one current step per available goal,
with a stable goal ID/context and observed completion criteria. The runner retains
the chosen ID and selection baseline, executes that goal's current steps and
periodically asks the model to continue or switch. The model receives the active
goal and age alongside game facts. A changed validity key, unavailable goal or
completed predicate triggers an earlier reconsideration.

This keeps the decision memory in the runner without a new Studio RPC. The Lua
adapter computes steps for each goal independently; constructing an option must
not commit global controller state to that option. Keep per-goal route caches
bounded and derive their updates from observations. Do not reset progress just
because the model chose or continued an intent.

A Lua-private state machine that needs to consume the chosen ID itself still
needs an additional supported channel; action.intent does not call onDecision.
Use runner-owned commitment when it fits instead of making that extension a
prerequisite. See describe for the current metadata schema and run options.

Ordinary action candidates can combine direct controls and short assists without
intent metadata. The current frame contract does not mix intent-tagged and
untagged actions in one nonempty frame. Do not invent completed-goal callbacks
or attach artificial goal predicates merely to put direct controls in that mode.
One-shot intents should disappear when their completion is witnessed; relative
completion predicates alone do not suppress a still-published repeatable goal.

## Review and evaluate the generated controller

For model-mediated play, check whether removing the model would leave every
intended model decision unchanged.
If so, a request for model-mediated play has become a scripted controller: review
where preferences collapsed the options and restore genuine alternatives.

Inspect the declared decision points in code and in a real trace. The runtime's
decisionId links candidate/model selection, dispatch and effect; decisionEvidence
separates automatic-only play, choices that never dispatched, and observed effects
of dispatched model choices. It proves participation, not model quality or victory.
Verify the actual resulting state transition and the user's objective as well.

Tune the smallest responsible part from evidence: bindings for wrong prompts,
capability execution for failed motion, guards for missing legal options, policy
context for poor choices, or the reducer for repeated/incorrect transitions.
Keep source/dependency versions and the failed cases so revisions are comparable.
