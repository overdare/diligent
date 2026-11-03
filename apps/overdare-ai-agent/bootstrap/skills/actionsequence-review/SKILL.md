---
name: actionsequence-review
description: Review saved OVERDARE Action Sequences for timing, collision/pose alignment and script signal references.
---

# Action Sequence review

Review saved assets and report reproducible mismatches with a track and time in seconds. Focus on how clips, collisions, VFX, camera timing and gameplay signals fit together. VFX appearance and animation naturalness are outside this review.

## Read and measure

Read the relevant GUID with `studiorpc_action_sequence_read`; omit arguments when the sequence needs
to be located. Saved data is the baseline for a proposed repair. Runtime `ActionRunner:Play(name)`
uses the instance `Name`, not JSON `ActionSequenceID`.

The timeline includes issues, resolved Control targets and nested VFX enabled keys. Clip durations
come from loaded assets or the offline catalog; unavailable durations remain unknown. For pose/timing
questions, select preview times near collision keys and animation/VFX boundaries. Red outlines show
collisions at exact key times; cyan crosses show evaluated control roots. Informational repetition
or cropping is not automatically a defect.

Preview uses an isolated editor pose, not live gameplay. World positions and distances are in cm. A negative signed distance puts the joint inside the shape; a positive value puts it outside. A joint outside a box alone does not prove a bad hit: weapons, extended reach and the intended target area can explain it. Arc/frustum distances, unavailable resources and failed previews remain unknown. `StartOffsetTime > 0` can shift editor blend weights relative to gameplay. Niagara randomness can differ between captures.

Treat sub-frame timing differences as informational unless a binding explicitly requires exact synchronization. A few milliseconds between a hit, VFX and camera onset does not by itself establish a defect. Compare nearby samples on both sides of a boundary; an enabled value at an exact key can depend on floating-point evaluation.

## Interpret findings

| Check | Evidence to compare |
|---|---|
| Track/key bounds | Start, end and key times against `[0, Length]`; point-based Control, Collision and Event tracks may have equal start/end |
| Blend/fade | Nonnegative durations within the track interval; same-slot animation overlap beyond the intended blend |
| Control reference | Resolved child path/class against `ProxyData`; attachment socket/offset and nested enabled keys |
| Collision/VFX timing | Collision key time and hand/foot/weapon distances against animation pose and Control enabled intervals |
| Signal identity | Nonempty trigger names, collision events and markers; key-trigger names/times against collision key data |
| Structure | Unique TrackIDs, reciprocal parent/child links, sorted unique keys, asset ID format |
| Gameplay references | Duplicate instance names and literal `Play`/signal subscriptions against actual names and runtimeSignals |

`scriptReferenceCheck.issues` contains external literal script-reference findings; top-level
`issues` contains timeline diagnostics. Custom signal names are valid when producer and consumer
agree. For partial scans or detected TPA controller bindings, use the
[script-reference interpretation](references/script-references.md); template conventions apply
only to the controller actually bound by the target's scripts.

Runtime clones are parented under the `ActionRunner`, with their child scripts under the cloned sequence. If the runner is under the character's Humanoid, a sequence child script reaches that Humanoid through `script.Parent.Parent.Parent`. The saved service hierarchy alone cannot establish a gameplay parent-lookup bug.

## Report and optional repair

For each finding give the instance name/GUID, original `trackIndex` and TrackID/name, time or interval,
measured values and expected relationship. Distinguish observed mismatches from convention-dependent suspicions.

For structured review output, use records such as:

```json
{"sequence":"Attack","instanceGuid":"...","findings":[{"trackIndex":3,"startTime":0.2,"endTime":0.2,"kind":"collisionTiming","severity":"warning","evidence":{"rightHandSignedDistanceCm":40,"vfxEnabled":false},"reason":"The hit key precedes the documented contact and VFX window."}]}
```

For a requested repair, `raw: true` provides saved JSON to copy and edit while preserving unrelated
fields and children. `studiorpc_action_sequence_write` with `dryRun: true` evaluates that proposal
without mutation; ordinary application changes the sequence and requires a separate level save.
