---
name: actionsequence-review
description: Review OVERDARE Action Sequence assets for track timing, collision and pose alignment, child references, signal names and gameplay naming conventions. Use for diagnosing or checking existing sequences; use actionsequence for authoring guidance.
---

# Action Sequence review

Review saved assets and report reproducible mismatches with a track and time in seconds. Focus on how clips, collisions, VFX, camera timing and gameplay signals fit together. VFX appearance and animation naturalness are outside this review.

## Read and measure

Complete these steps in order. Finish and interpret the saved-data preview before validating a proposal with `write` + `dryRun`; the measured saved state is the baseline for comparing proposed changes.

1. Call `studiorpc_action_sequence_read` without arguments to identify instance GUIDs, instance names and duplicate names. The runtime `ActionRunner:Play(name)` uses the instance `Name`, not JSON `ActionSequenceID`.
2. Read each relevant GUID. Inspect the saved timeline, issues, resolved Control targets and nested VFX enabled keys. Clip durations come from loaded assets or the offline catalog; unknown means unknown. Informational repetition/cropping is not automatically a defect.
3. For a suspected pose/timing mismatch, read the GUID with `preview: { times: [...] }`. Choose the collision key time and nearby animation/VFX boundaries, at most 22 distinct times in `[0, Length]`. Use `preview: true` or `preview: {}` for the default six times at 0%, 20%, 40%, 60%, 80% and 100% of Length. The image groups up to six requested times per block, with front/side rows in each block. Red outlines are collision bounds at exact key times; cyan crosses mark evaluated control roots. Use the numerical collision distances and enabled states as evidence, alongside the image.

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

The common binding convention uses `Sequence` for sequence lifetime, `KeyInput` for combo input, `CancelWindow` at the tail for immediate combo/general cancel, `HitTrigger` or `HitTriggerN` for collision events, and `ActiveTrigger` or `ActiveTriggerN` for markers. These are gameplay conventions, not engine requirements. Missing `Sequence`, or having only one of `KeyInput`/`CancelWindow`, is informational unless the actual binding script requires otherwise. A `Sequence` ending before dependent tracks, an off-tail cancel window, or overlapping input/cancel windows warrants checking that script.

Script-reference checks cover literal calls at level scope. Inspect the relevant script when it uses aliases, computed names, runtime-created sequences or conditional subscriptions. Do not infer missing signals from an unavailable/partial script scan. Custom signal names are valid when their producer and consumer agree.

Runtime clones are parented under the `ActionRunner`, with their child scripts under the cloned sequence. If the runner is under the character's Humanoid, a sequence child script reaches that Humanoid through `script.Parent.Parent.Parent`. The saved service hierarchy alone cannot establish a gameplay parent-lookup bug.

## Report and optional repair

For each finding give the instance name/GUID, original `trackIndex` and TrackID/name, time or interval, severity, measured values and expected relationship. Distinguish an observed mismatch from a convention-dependent suspicion. Report a clean review when there is no supported defect; do not invent one to fill a quota.

For structured review output, use records such as:

```json
{"sequence":"Attack","instanceGuid":"...","findings":[{"trackIndex":3,"startTime":0.2,"endTime":0.2,"kind":"collisionTiming","severity":"warning","evidence":{"rightHandSignedDistanceCm":40,"vfxEnabled":false},"reason":"The hit key precedes the documented contact and VFX window."}]}
```

Repair only within the user's requested scope. Read with `raw: true`, copy the returned `rawJsonPath` to an editable local file, preserve unrelated fields and children, and call `studiorpc_action_sequence_write` with `instanceGuid`, `jsonFilePath` and `dryRun: true`. The dry run does not change the level. Compare its issues/timeline, then apply the same file if the edit is authorized and reread to verify. Applied `warnings` are diagnostics; `success` alone does not prove the sequence is correct. This write tool replaces the older agent tool name `apply_json`.
