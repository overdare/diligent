# Diagnose the failing boundary

- **Discovery:** `found:false` is recoverable absence. Read actual installed names and inspect the current game's sources before authoring. RPC timeout or unavailable client data is not proof that the asset is missing.
- **Preparation:** Check the validation report, source hash and driver readback. A successful editor edit followed by save failure must not be replayed as if nothing happened. Inspect/save the existing edit first.
- **Model service:** Identify the configured provider first. Laya requires native Ollaya, not an ordinary Ollama endpoint, and warms before PIE. OpenAI Decisions uses its official endpoint and server-side API credentials; do not assume existing ChatGPT authentication is interchangeable. Resolve the request host/model and inspect the actual status without logging credentials. A service failure should not trigger unrelated gameplay-code changes or firewall exposure.
- **Startup:** The runner waits for usable observations within its startup bound. Distinguish an initializing client/driver from a different nonempty client id or changed PIE session. A malformed frame or adapter error still needs repair.
- **Behavior:** Compare the selected candidate, actual input reply, subsequent state and game feedback. The runtime currently checks the first newer post-input frame; it does not wait until every effect expectation becomes true. A failed expectation is recorded, not an automatic in-game recovery command. Choose assertions with appropriate game-side evidence and timing.
- **Stuck:** Inspect the summary's inactivity interval, progress source, last action/state and the trace's progress declarations. The default watchdog allows 15 seconds without meaningful progress, pauses for one bounded declared wait per sequence, then cancels pending work and cleans up its owned session. `stuck` does not establish game failure. Diagnose missing candidates, a blocked route, ineffective inputs, stale signals or an incorrectly modeled normal wait before changing the adapter. Do not disable or continually renew the watchdog to conceal a stall.
- **Coverage:** Check the declared inventory and per-target stages. A high count of tiny input events, candidate availability, or a successful episode is not source-code branch coverage. `observedSamples` counts frames reporting a target; a latched witness can appear in hundreds of frames after one event. For occurrence counts, correlate unique physical cycles or authoritative feedback sequences with dispatched actions; even multiple candidate-effect ids can describe one physical event. Label pure predicate/self-check results separately from live gameplay evidence, including when the server forwards them in feedback.
- **Latency:** Separate model request wall time, observation cadence, dispatch delay and action execution time including intentional waits. Observation overlaps decisions/input. Local inference removes external model-server round trips, not Studio processing or cross-host RPC latency. Measure before claiming a control frequency.
- **Decision attribution:** Inspect `decisionEvidence` and correlate candidate, choice, dispatch and result by `decisionId`. `not_exercised` means no model choice; `selected_not_dispatched` and `dispatched_unverified` identify later missing evidence. `effects_observed` confirms effects of executed model choices, not model quality or victory. If model-mediated play was intended but every choice was a singleton, use [controller-design.md](controller-design.md) to check whether preferences removed genuine branches.

Use the observed failure to change the responsible boundary. Fix a bad binding or candidate in the adapter; do not conceal a transport/runtime defect by relaxing the game's terminal rules. Keep failed attempts in the report so later improvements can be compared against the same objective and source version.

## Repeated motion or GUI disagreement

Read [interaction-state.md](interaction-state.md) for the mapping repair, then
classify the actual trace rather than the visual appearance of a loop:

| Evidence | Boundary to inspect |
| --- | --- |
| Selected target differs from GUI focus or actual recipient | Binding, stale observation or competing input recipients |
| Native GUI/focus/range are ready, but the adapter blocks input | Contradictory readiness/completion predicates or an unsupported extra heuristic |
| Goal is invalidated after every alignment | Catalog disappearance, phase-dependent validity, candidate capping or a nil step erasing a valid goal |
| Focus completes, open is offered, but the model chooses another focus | Decision granularity and policy context; consider target-level commitment when target selection is the test |
| Exact feedback exists, but effect keys disappear | Verification state incorrectly tied to the current candidate subset |
| No supported anchors after entry | Arrival/streaming, binding/type coverage and local scope; not proof of an empty room or an interaction fix |

Distinguish camera drag from translation using dispatched events and actual
camera/position changes. A repeated motion can be an executor correction, a
reselection caused by invalidation, or a real model choice after completion.
These require different repairs. The policy interval does not prevent earlier
reselection on completion or invalidation.

## Comparable runs and host provenance

Keep the exact source hash, adapter settings and explicit invocation together.
Omitting an argument after resume can restore a default rather than the prior
test's setting. Do not attribute that comparison solely to an adapter edit.

Identify the actual open game, the sidecar's working directory, Studio host and
model host. Check log/capture provenance once; do not repeatedly search or cite
a known unrelated mounted-project Play.log. A completed owned episode followed
by slow trace persistence, an approval wait or report generation is not evidence
that gameplay is still stuck. Diagnose that delay from the relevant tool/host
state rather than launching another episode or changing approval settings.

For goal-based exploration, compare a stuck report with both physical displacement and productive milestones. A lifetime best-distance counter can stop advancing during a legitimate return route, while counting every movement can reward endless loops. Track bounded route-leg or objective progress from actual observations and document what the watchdog means. Do not describe a no-progress stop as a collision unless the movement evidence supports it.

If source inspection reveals a game defect, distinguish a possible code path from proof that it caused the observed incident. Follow the user's current edit scope. When a game fix is explicitly authorized, verify both the rejected invalid case and the valid behavior that must still work. Record the changed game version as well as the harness version; a replay with changed game behavior is a new baseline for evaluating controller improvements.
