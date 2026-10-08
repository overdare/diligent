# Harness authoring and test coverage

Use the live harness tool's `describe` operation for the schema; do not maintain a separate copy of its full limits or input grammar here.

For direct-control exploration, publish short movement, look and interaction actions with useful observed alternatives. Short approach or alignment assists may share the same ordinary action catalog when enabled by the selected control configuration. Derive durations, input routes and directions from the current controller; a universal W key or fixed camera gesture is not guaranteed. Bind direction/focus-sensitive actions to material camera, modal or target changes so a slow choice cannot execute with a different meaning. Confirm movement on its intended axis with meaningful thresholds, not merely any displacement.

For deliberate multi-step commitment, optional intent metadata can attach a goal to each next physical step. Compute all steps from the same observed facts with goal-local caches; do not select a nearest target globally before constructing the catalog. The runner retains the model-selected goal and dispatches its changing steps, then reevaluates on completion, invalidation or the configured policy interval. Goal completion compares actual state with the original selection-time baseline; continuing the same goal preserves that baseline. Keep meaningful alternatives present so the model can change strategy. Author distinct step effects, goal completion and whole-game terminal checks. A nonempty frame must use either intent-tagged or ordinary actions throughout.

`start()` can bind accepted state and feedback or request a read-only synchronization through an existing API. `observe()` reads those facts and current geometry/GUI, then returns state, candidates, logs and any witnessed terminal. Gameplay actions are balanced input batches executed by the runner, not mutations performed by `observe()`.

If composing adapters, initialize dependencies explicitly and once through the selected adapter's lifecycle. Do not rely on another enabled harness driver to start a required module or observe the same mutable controller concurrently. Preserve dependency names and source versions alongside the selected adapter hash so a successful run can be reproduced.

Track the freshness of the state source itself. The common driver's advancing clock proves that publishing is alive, not that a cached server snapshot is current. Withhold actions whose required facts are unavailable or too old for that game's mechanics. Preserve unknown values rather than substituting authored GUI defaults.

Use the states, transitions and decision points from [controller-design.md](controller-design.md) to generate parameterized candidates. Remove illegal options through guards, and expose preference tradeoffs in compact state/descriptions rather than preselecting the only strategy in code. One genuinely forced continuation runs deterministically; multiple meaningful alternatives use the configured decision provider. Do not manufacture equivalent alternatives to force model calls. The chooser receives state and candidate descriptions, not the raw feedback log, input sequence or entire world.

Derive interactions from the live controller: actual input route, prompt key/hold time, focus eligibility and prerequisite prop. An assignment may omit a binding that the live controller derives. Check competing prompts sharing a key and modal movement/camera locks before diagnosing navigation failure. Use the game's supported physical input, including touch gestures when its camera requires them; do not enable suppressed prompts to bypass those conditions.

For the target/GUI/recipient mapping and local interaction-state rules, use [interaction-state.md](interaction-state.md). Keep full verification facts available after a target leaves the bounded candidate list; sorting or removing a completed candidate must not erase the feedback counters needed to verify its just-dispatched input.

Bind validity to the relevant round, phase, target or other context. Use short enough self-contained batches for the game's response window, and derive movement from the current camera/controller. Recheck destination/path/landing assumptions in dynamic geometry rather than treating any displacement as arrival. Do not retain disappearing targets merely because a cache timer has not expired.

Continuous observation does not steer a batch already executing: the runner serializes decisions and input batches. Budget observation age, decision/dispatch delay and the full input sequence, including waits, against the hazard's response window. If a long action requires mid-action correction, split it at a useful observed boundary and verify that the extra decision delay fits.

The chooser receives the last three completed input outcomes in `controller.recentActions`, with action ID, optional intent ID and `effect_confirmed`, `effect_unconfirmed` or `not_checked`. Use concise semantic IDs. This history includes automatic inputs and is reset for each episode; it is not a Lua callback or a discovered map. Unconfirmed means the expected effect was not yet verified, not that nothing happened. Supply bounded observed discoveries or other relevant memory in decisionState when the task requires them; raw feedback and verification values are not automatically sent as history.

Keep `start()` and recurring callbacks bounded so the harness does not stall Studio. For large geometry sets, snapshot stable native properties once and compute topology from numeric data; use local neighbors or a spatial index when all-pairs work is too costly. Recheck mutable geometry and availability before offering actions, and invalidate cached topology when the arena changes. A startup timeout alone does not prove which computation caused it.

Define coverage from the requested test and code analysis. For example, a double-jump test may need grounded setup, first jump, an actual second upward impulse, and landing. It need not cover shop UI or every match phase. State/event targets are credited when the adapter reports a witnessed fact; action targets require nonempty effect expectations that pass after completed input. Include a source path/symbol on targets where useful for review.

When a value can change because of other players or timed game logic, use feedback or a player/target correlation to establish the tested effect. An unrelated counter or HP change is not automatically attributable to the chosen input.

For optional coverage metadata, the contract supports stable `coverage.targets`, observed state/event ids and `actions[].coverageKey`. Action ids may vary per destination, but coverage keys should identify the stable tested behavior. Use separate keys when behaviors are materially different. Unasserted actions, unavailable scenarios and effects not observed remain uncovered.

Drive the remaining checks through meaningful test stages or compact progress facts in model state when needed. Declaring a catalog produces a report; it does not by itself make Laya select every target or schedule missing scenarios. Preserve the game's validity and the user's objective when advancing a stage.

Define meaningful progress for the no-progress watchdog. Advance the contract's monotonic progress sequence on witnessed objective or route milestones, useful effects, or relevant phase transitions. Clocks, action attempts, repeated GUI toggles, position jitter and walking in circles do not establish progress. Keep the sequence increasing across respawns. For legitimate hiding, countdowns or cooldowns, declare a bounded normal wait derived from game evidence; a repeated declaration cannot renew the same allowance. Reevaluate the danger or condition at its deadline. Older adapters without progress telemetry fall back to changed confirmed non-wait input effects; update them when that cannot distinguish a normal pause from being stuck. Updating the managed driver is required to forward the new telemetry.

Keep the JSON model state compact. When verification requires large per-target tables or privileged facts, return optional `decisionState` with just facts appropriate to the selected observation scope; the runner still evaluates input effects and intent completion against full `state`. Without that projection, the chooser receives full `state`, so it is not a player-limited observation boundary by default. Candidate descriptions must respect that same scope. Keep the goal and candidate descriptions concise as they share the model's context budget. Do not send Instances, vectors as userdata, raw Source, large tile catalogs or every historical event. Geometry calculations stay in the adapter; model state retains the facts needed for the current decision. Log bounded real feedback with unique ids for diagnosis.

Check the complete chooser envelope: outer goal, decisionState, runner context and candidate descriptions. Byte counts are a sizing aid, not a tokenizer guarantee. Every offered target needs its decisive distinctions, even if a concise description carries them instead of another state table. Prefer relevant bounded summaries to blindly dropping the later candidates' context. Preserve destination-specific remaining work and unknown/unloaded status; visit counts alone do not explain whether a revisit is useful. A native `state_truncated` response remains an error, not an acceptable partial observation.

Terminal evidence must match the test objective. Distinguish a lost round from a lost multi-round match, temporary respawn from final elimination, and a survival-duration objective from winning the game. Do not alter win rules or label timeout as success to make a report green.

For a test that requests a retained approach assist, the following example
annotates the game's approach function. A direct-control test would instead offer
its executable movement/look choices without this intent wrapper:

```lua
local step = approach(room) -- Game-specific function written by Diligent.
step.intent = {
    id = "visit:" .. room.id,
    description = room.description,
    validityKey = roundId .. ":" .. room.id,
    completeWhen = {{key="currentRoomId", op="equals", value=room.id}},
}
```

Build the current step for each genuinely available goal and return them together.
Do not assign a shared `chosenRoom` while constructing these options. The frame's
`state.currentRoomId` must come from actual room-entry evidence. Step expectations
may verify motion/aim; `completeWhen` verifies the goal. `intent_completed` in the
trace is distinct from `decisionEvidence.effects_observed`, which may establish
only a successful substep, and from the game's terminal.

Keep each action.coverageKey scoped to its physical-step effect. Do not attach a
whole delivery/room-completion target to an aiming or walking step. Whole-goal
coverage needs its own actual state/event witness, while intent_completed links
that completion to the runner's selected goal.
