---
name: character-animation
description: Create, edit and publish animation clips on the built-in Studio character or an existing single-skin Model.
---

# Character Animation

## Select the original rig first

For an existing Workspace Model, call `studiorpc_animation_read` with its `modelGuid`. This selects the Model's single skeletal MeshPart and returns its original bone names, bind transforms and component axes. Create a clip with the same `modelGuid`; later reads and writes can infer the rig from `assetPath`. Omit `modelGuid` to use Studio's built-in character rig. Read an existing animation with `assetId` and this selector to obtain an editable copy while preserving the source. Publish with `studiorpc_animation_publish`; clips retain their original Skeleton.

The returned `rig.family` identifies solver support: `oda` is Studio's built-in character skeleton;
`general` is another skeleton, using its original bone axes and keys without the built-in pins or ground solvers.
For `general`, `dryRun` reports original bone positions, component axes and skin heights; preview uses the original materials and component +X/+Y views. Measurements use the selected rig's component axes without anatomical inference. Source clips with animated scale, additive poses, events or root-motion extraction are rejected rather than losing those features in a copy. Existing hierarchy, bind pose and weights are preserved; this editing path does not perform rigging.

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

For built-in character support poses, use the [pin and ground examples](references/default-character-rig.md#grounding-examples).
These solvers bake keys and are unavailable for general rigs.

To change an animation you only know by its id (an Action Sequence AnimationTrack, a script), open it with studiorpc_animation_read `assetId`. Edit the returned assetPath, publish, and put the new id where the old one was used.

## Save and publish

The saved `assetPath` remains editable. Gameplay and Action Sequence tracks need the published
`ovdrassetid://N`; each publish creates a new ID. Pin `entryJumpDeg` and `exitJumpDeg` describe
transitions into and out of solved keys, which may need neighboring transition keys. Floor heights
and bone axes are measurements rather than contact or visual-quality verdicts.
