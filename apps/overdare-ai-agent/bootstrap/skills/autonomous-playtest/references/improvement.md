# Improve actual play

Use this reference when the user asks for better play or identifies a weakness in an existing harness. Retain the requested objective and budget. A request for better survival and a request to exercise a particular mechanic may require different candidate choices.

## Establish a comparable baseline

Read the current adapter and the relevant previous summary/trace. Choose evidence for the reported weakness and the overall objective: for example, time alive in the same round, progress, damage taken, unintended falls, or time stranded without an executable action. Pair it with completed/confirmed action counts and attempted distances. A controller can improve short-hop accuracy while exhausting escape routes or never attempting the useful longer hop.

Keep run id, harness hash, relevant game version, budget and effect criteria with comparisons. Compare the same participation window and reset/respawn semantics. If the inventory or assertions change, compare common behaviors and name the added checks instead of comparing aggregate coverage percentages. One episode supports a result for that episode; use further bounded comparable trials when authorized and needed to establish repeatability.

Preserve the explicit decision interval, model/endpoint, duration and watchdog on
every comparison call, together with adapter assistance settings. A saved and
validated final revision is not a tested improvement if its episode never offers
the changed capability. Mark that scenario not exercised; do not borrow an older
hash's successful interaction as acceptance for the final code.

Record assistance and observation scope as well as the test objective. A direct exploration run and a run supplied with approach helpers or hidden target locations test different behaviors. For player exploration, inspect discovery, repeated blocked attempts, recovery choices and productive progress, including unsuccessful runs. A clear achieved by a supplied route does not verify route discovery. Do not infer a human skill level merely from an assistance setting or one episode.

Locate movement failures in the last live observations before the transition. Post-elimination relocation or respawn coordinates, including cached maxima that span those transitions, do not establish where a player fell or which action caused it. Check the game's relocation path when those coordinates jump discontinuously.

## Diagnose the offered behavior

Trace a concrete failure through candidate availability, selection, dispatch, physical effect and subsequent game state. Laya cannot select a useful capability the adapter never offers. Check range caps, cooldowns, input order and timing against this game's controller and observed motion before blaming model choices. Calibrate from actual takeoff, impulse, travel and landing evidence when movement timing is the issue; increasing a destination range or changing an action description does not establish reachability.

Evaluate the state after the action too: remaining exits, support lifetime, available resources or exposure to the next attack. Derive constraints from current geometry and mechanics; a fixed preference such as staying central is not valid for every game. When filtering removes every useful action, identify whether waiting is safe or whether the game offers a real recovery. Record that condition so repeated waits near a hazard are diagnosable.

For exploration, retain a useful target across doorway and streaming transitions; missing objects immediately after room entry do not prove an empty room. Give expected streaming a bounded settling period. When an interaction stays unavailable, inspect its prerequisite or choose a productive fallback, such as delivering carried resources, before retrying. Compare collision predictions with actual traversal evidence around stairs and elevation changes; keep map-specific route corrections in the adapter and record their limited scope.

When the model repeatedly explores instead of collecting or delivering, inspect the exact compact payload before adding forced priorities. Candidate descriptions should name the resource and payoff, not just an opaque target ID. Distinguish known-empty rooms from rooms whose contents are unknown or unloaded. Include concise visit/outcome history when it explains repeated detours, while preserving legal collection, exploration and delivery alternatives. More model calls alone do not demonstrate better decisions.

Check whether the repeated choice is a failed step or a successfully completed
but unproductive subgoal. If focus succeeds and the model keeps switching away
from an available open action, target-level inspection may be a better decision
boundary than more focus calls. This preserves model choice of target while the
executor completes its mechanics. Verify the new intent through actual target
completion; a reduction in model calls or a run stuck before the target proves
neither success nor regression of that path.

## Make a falsifiable revision

State the trace-supported hypothesis and the result that would support or refute it. Change a bounded set of related adapter behaviors, keeping meaningful effect checks. Use the next episode to measure both the requested improvement and any regression in the overall objective. Report mixed results explicitly: a longer jump can be verified while survival gets worse. Do not retain a prior version's good result as evidence for the current version.

Keep useful physical events identifiable by round, player, target and cycle, with only the compact decision facts in model state. For ambiguous game-versus-harness failures or missing signals, use [diagnosis.md](diagnosis.md) before changing the responsible code.
