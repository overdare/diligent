# Map interaction choices to real targets and results

Use for object/GUI interactions and focus or input-recipient failures. Derive the
mechanics from the current game. Drawers are an example, not a required UGC schema
or a claim that the Horror PoC's final controller is reliable.

## Bind identity before choosing actions

The mapping is game object ID -> episode-local alias -> observed state -> available
semantic choice -> physical input -> correlated result. Diligent authors the mapping;
Laya receives the goal, compact facts and candidate descriptions, then returns an ID.
It does not read arbitrary game Lua or infer resource roles from pixels in this path.

Use the game's stable interaction identifier and the actual prompt/control binding.
Adjacent controls on one object can have different IDs, states and prerequisites.
Keep the object/furniture grouping as well as the individual anchor identity. A
short alias such as t3 is useful only while it retains an unambiguous real binding;
it need not identify the same object in another episode. Track binding replacement
or pool reuse so stale visibility and input results do not attach to a new object.

Derive resource roles and prerequisites from game code and observable metadata.
For example, a game-specific item-type check can establish that a revealed object
is a mission battery. That check is adapter knowledge, not autonomous discovery by
the chooser or a universal collection rule. Explain the resource/payoff in candidates.

## Separate facts that can disagree

| Fact | Example evidence |
| --- | --- |
| Intended target | Runner decision/intent ID mapped to the actual object |
| Physical reach and geometry | Character position, authored/live range, supported collision queries |
| Focus and advertised interaction | Actual controller target; native shown/hidden state and action text |
| Input recipient | Supported native hold/trigger events identifying the receiving prompt/player |
| Result | Fresh authoritative feedback for that target and resulting state/inventory |

Subscribe to native GUI/input events when the game's supported API exposes them.
An enabled prompt or positive range alone does not prove that it is displayed or
receives the shared key. Preserve unknown GUI/server values. A camera heuristic
must not contradict verified native eligibility without a game-backed reason.
Use compatible predicates for focus completion and input readiness; if more
alignment is needed, expose that recovery instead of removing the only next step.

Handle event ordering: a native shown event can precede owner registration on the
next observation. On rebinding, distinguish a fresh event from an older pooled
instance's visibility. Do not discard a fresh show event or invent one from geometry.

Check the game's actual transitions after opening. A revealed item can replace or
suppress its container's prompt. Model that state and its collect/other-target
alternatives rather than repeatedly trying to focus an unavailable close control.
Closing an upper drawer before a lower one is not a universal prerequisite; require
code or observed blocker evidence for that dependency.

## Retain the decision at the level the test needs

For a target-selection test, a small inspect(target) capability can execute:

```text
approach -> acquire exact focus -> eligible input -> await target feedback -> complete
                                      |                       |
                              blocked/recover             unconfirmed
```

Use existing action.intent metadata. Keep the semantic ID and target/lifecycle
validity stable while the physical step changes. Complete from the actual goal,
not successful movement or camera alignment. Keep other targets, collection,
leaving and the configured reconsideration boundary available. Do not package a
whole collection/delivery route into this local capability. Direct-control or
focus-specific tests may intentionally use the finer-grained mode.

Compute each offered goal independently. Candidate construction is not a model
choice and must not select a global target. There is no Lua onDecision callback.
An observed input recipient is evidence of native input, not by itself evidence
that the model selected that recipient; correlate with the runner trace.

For unavailable steps, distinguish observed pending work, blocked execution and
invalid targets. Use bounded waits for real animation/feedback, bounded physical
recovery for a blockage, and invalidation for disappearance or changed meaning.
Do not use an endless wait to preserve an impossible goal. Recovery displacement
must agree with the planned direction, not merely any horizontal movement.

## Confirm the selected effect, including unintended effects

A shared key can trigger more than one advertised prompt. Inspect competing
recipients before dispatch where observable and offer a feasible reposition or
other input route supported by the game. A guard that disables input also needs
a recovery/alternative; a description saying "reposition" is not that capability.
Do not enable prompts, change ranges or fire gameplay remotes to bypass eligibility.

Correlate choice, dispatch, actual recipients and authoritative responses by target,
player, lifecycle and sequence/time. Record extra effects as incidental. Opening
the selected drawer and accidentally collecting another object's item does not
prove a model-selected collect action. Pre-dispatch checks reduce races; subsequent
recipient/result evidence is still needed.

For a confirmed opening, a suitable game may expose open=true plus a fresh target
feedback version and native input serial. Use the evidence actually available;
do not invent counters or a universal server callback. Keep these facts in full
state after the candidate disappears. A receipt arriving later than the first
post-input frame may complete an intent without making the earlier step assertion
true retroactively. The current runner records failed expectations; it does not
automatically repair the adapter or wait indefinitely for every effect.

Bound native hold-without-trigger and trigger-without-confirmation cases using
the actual hold/cooldown/response semantics. Preserve the observed reason and
relevant context so a changed position, prerequisite or lifecycle can justify
retrying; neither permanent blacklisting nor repeating the same press is sufficient.

## Memory and rendering scope

Keep detailed target outcomes in the adapter/full trace. Send a bounded relevant
view to Laya: current objective/resources, target identity and grouping, remaining
observed work, readiness/blocker and relevant outcomes. The runner's active intent
and last three physical outcomes are not a durable semantic history. Repeated
waits can evict earlier outcomes. Do not discard the decisive state for a selectable
target merely to shorten the payload; use concise candidate descriptions instead.

Treat no known work, not yet loaded, unsupported interaction type and confirmed
empty as distinct states. A room-stream selection is not physical arrival, and
zero adapter-supported anchors does not prove that a room contains no gameplay.
Known work may be exhausted while hidden contents remain unknown. Renew memory
from actual observations, not the desired next action.

Compare rendered UI with telemetry when visual agreement matters. Identify the
PIE client, active view, capture time and any device-preview/reference-image mode.
Native shown/focus events are not proof of rendered pixels. A screenshot path on
Windows may be unreadable on a Mac agent host; verify an accessible image before
claiming pixel review. A preview caption alone does not prove its HUD is frozen.
