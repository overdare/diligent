---
name: character-animation
description: Create, edit and publish animation clips on the built-in Studio character or an existing single-skin Model.
---

# Character Animation

## Select the original rig first

For an existing Workspace Model, call `studiorpc_animation_read` with its `modelGuid`. This selects the Model's single skeletal MeshPart and returns its original bone names, bind transforms and component axes. Create a clip with the same `modelGuid`; later reads and writes can infer the rig from `assetPath`. Omit `modelGuid` to use Studio's built-in character rig. Read an existing animation with `assetId` and this selector to obtain an editable copy while preserving the source. Publish with `studiorpc_animation_publish`; clips retain their original Skeleton.

Read the returned `rig.solvers` for the selected rig's supported pin and ground inputs. Explicit chains
and translation bones work with supported original rigs; the built-in hand/foot shorthand, flat feet
and toe pivots require the built-in character. A missing capability is unadvertised by that Studio build.

For original rigs, `dryRun` reports original bone positions, component axes and skin heights; preview uses the original materials and component +X/+Y views. Measurements use the selected rig's component axes without anatomical inference. Source clips with animated scale, additive poses, events or root-motion extraction are rejected rather than losing those features in a copy. Existing hierarchy, bind pose and weights are preserved; this editing path does not perform rigging.

For facing and runtime integration, use the shared
[custom-character guidance](../custom-character/SKILL.md#facing-and-runtime-frame).
For the built-in character, read the [measured rig axes and shipped-motion examples](references/default-character-rig.md).

`studiorpc_animation_write` with `dryRun: true` returns pose measurements without saving or
rendering: `joints` contains bone positions, `lowestPointCm` groups lowest skin vertices by
original dominant influence, and `directions` contains component-space bone axes. Preview is
opt-in and supplies the rendered view; these measurements do not infer palms, soles or support.

## Animating

Block the story poses first (anticipation, the action's extreme, the recovery), then time them:

- Anticipation moves opposite to the action: dip before a jump, wind back before a punch.
- Fast actions take 2–4 frames. After an impact, hold for a few frames and overshoot slightly, then settle.
- The hips lead, the chest follows, and the head and arms arrive last. Arms swing against the legs.
- Use `cubic` for most keys, `linear` into an impact, and `constant` for a snap or hitstop.
- Choose loop endpoints and one-shot ending poses for the intended transition or held pose.
- The hips rise only once something below supports them: feet planted under them, or a hand on the floor.
- Holds keep a little motion (breathing, a small drift) so they don't read as frozen.

## One-shot ending poses

Choose when the character settles in clip time: `frame = seconds * fps`. For example, a fall
that settles at 0.9 s at 30 fps reaches its lying pose at frame 27. Keep that pose through a
later clip end, using constant interpolation over a truly still tail to avoid cubic drift.

Runtime pose retention is separate from those keys. A non-looping AnimationTrack naturally
ends and fades out; `Looped=false` and `Stop()` do not hold its pose. On a still-playing track,
pause before it reaches `Length`, then set the desired clip time:

```lua
track:AdjustSpeed(0)
track.TimePosition = holdFrame / fps
```

Use the track's `TimePosition` in seconds for the trigger; elapsed wall time differs when playback
speed changes. Leave room after the hold time so natural completion has not already stopped the
track. For an NPC, control its track from the server, with the intended priority and blend weight;
continuing idle/walk tracks can otherwise blend into the held pose. Resume with `AdjustSpeed`
or stop/fade the track when the gameplay state releases it.

## Pins and ground

Choose the anatomy, support phases and trajectories for the requested character. Studio solves the
declared constraints and reports measurements; it does not choose limbs, a gait or contact timing.

An explicit pin names three bones in direct parent-child order:

```json
{"chain":["UpperLeg","LowerLeg","Ankle"],"frames":[0,12],"position":[10,20,8],"pole":[10,40,35]}
```

Targets and pole points use component-space Z-up cm. Omit `position` to hold the effector origin at
the first frame, or supply an ascending `path` of `{frame,position}` targets instead. Fixed targets
preserve the effector's component orientation at the first frame; paths preserve its authored
component orientation on each frame. The pole selects the bend direction; otherwise an explicit
chain uses its current bend plane. A straight or degenerate bend plane requires a valid pole.
Links must have positive lengths, with positive uniform ancestor scales. An explicit chain has no anatomical
foot frame: `flat:true` and `pivot` are unavailable. Use the returned bone axes and rendered pose to
author foot orientation. `maxErrorCm` and `outOfReachFrames` measure baked effector-origin error.

Ground aligns evaluated skin with a declared component-Z plane:

```json
{"frames":[0,12],"translationBone":"Root","heightCm":0,"bones":["Ankle","Toe"]}
```

`translationBone` receives the vertical correction and must be an ancestor of, or equal to, the selected
skin's influencing bones. `bones` selects vertices with any positive weight on a listed bone; omit it to select all
skin vertices. This selection is independent of the dominant-influence grouping in `lowestPointCm`.
`heightCm` defaults to 0. Supplying either `heightCm` or `bones` requires `translationBone`; frames alone
retain the built-in character's original ground behavior. General rigs require an
explicit translation bone. Check the selected skin and intended support before applying ground to a
range; it aligns the lowest selected vertex on every frame, including frames meant to be airborne.

Ground solves before pins. Its `lowestCm` and `maxHeightErrorCm` reports measure the final pose after
all solver passes, using LOD0 linear skin without morph, cloth or world-position-offset effects.
Both solvers bake into saved keys; replacements must supply the authored keys and solver requests
again. For built-in character shortcuts and measured examples, use the
[pin and ground reference](references/default-character-rig.md#grounding-examples).

To change an animation you only know by its id (an Action Sequence AnimationTrack, a script), open it with studiorpc_animation_read `assetId`. Edit the returned assetPath, publish, and put the new id where the old one was used.

## Save and publish

The saved `assetPath` remains editable. Gameplay and Action Sequence tracks need the published
`ovdrassetid://N`; each publish creates a new ID. Pin `entryJumpDeg` and `exitJumpDeg` describe
transitions into and out of solved keys, which may need neighboring transition keys. Floor heights
and bone axes are measurements rather than contact or visual-quality verdicts.
