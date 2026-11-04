---
name: custom-character
description: Rig and animate a custom single-skin character, then publish and connect it to gameplay. For clip edits on an existing rig, use character-animation.
---

Read `studiorpc_character_api` for the connected Studio's capabilities and native
limits. It combines those facts with the Diligent-owned
[authoring reference](references/authoring.json). An unavailable guide means the
Studio contract version needs a matching authoring reference; do not infer support
from a guide written for another version.

## Select the source and author data

Inspect an existing Model with `studiorpc_character_inspect(mode=source)`. Use the
returned source kind and revision. Inspected static or baked ProceduralModel input
uses part GUIDs and the returned final vertex IDs. Exactly one region is skinned;
other captured parts may be static Bone attachments. Existing-rig input preserves
the original Skeleton, mesh, bind poses, weights, materials and props, and accepts
only new motion with `target.kind=animation_only`.

For privately generated geometry, read `studiorpc_proceduralmodel_api` and write
only the geometry recipe. Supply `rig` and `motion.document` as separate structured
data, using generated part names as regions. Author anatomy, hierarchy, weights and motion for the requested character;
Studio builds and measures the supplied data without selecting a species or gait.

Authoring data uses Unreal Z-up centimetres and quaternion parent-local poses.
Lua uses Y-up coordinates. `animation.read/write` uses a different Euler delta-key
format; read that tool's contract before editing a clip through it.

For imported FBX, compare the inspected source bounds in cm with the intended size: a 1.8 m
character should be about 180 cm tall. Metre-valued coordinates need a factor of 100, but an
importer may already have converted them. Use `desired size in cm / inspected size in cm`
for a remaining size correction. Prepare the import or working source at the intended size before
building a new rig, then use its returned vertices and transforms consistently for geometry,
bind poses and motion translations. Existing-rig animation editing preserves the imported rig.

## Facing and runtime frame

The existing RigBuilder binding aligns mesh-local +Y with actor forward. For new characters,
keep geometry, bind poses and motion consistent with the intended runtime frame. Body snaps to
the native character mesh; Body.CFrame does not set a persistent mesh-frame offset.

FBX axis metadata describes the coordinate frame, not which way the character's face points.
For a new rig intended for this binding, align the working geometry and rig with mesh-local +Y
before authoring motion. Existing-rig edits retain its original frame. Choose preview camera
angles independently; rotating a camera changes the view, not the character's runtime facing.

`motion.document.forwardDirection` controls observation travel, not anatomical facing or binding.
Rendered facing and actor travel are separate facts; sideways or backward motion may be intentional.

## Choose review for the task

Build with `commit=false`; it saves a draft without automatically rendering review
captures. Choose the observations useful for the requested action and its risks:
silhouette, a selected joint deformation, contact, a loop boundary or travel.
Each `mode=observation` call captures only the selected preset if missing, or reads
its saved evidence. `refresh=true` recaptures any selected preset. Probe operations
use explicitly authored `observationBones` or `bendTestRegions`; missing selection
is unavailable, never inferred anatomy. Revise with a new requestId; retries reuse frozen inputs.

Commit the exact four draft revisions; Studio checks source and native asset
integrity, independently of the selected visual review. For optional separate-process diagnostics,
see [source replay](references/source-replay.md).

## Publish and connect existing gameplay

Use `studiorpc_character_export(mode=publish)` for ordinary numeric asset IDs, then
explicit `studiorpc_character_build(mode=apply)` with the reviewed publication and
source graph revision. Recipe-only drafts lack inspected Workspace part identities
for apply. Use FBX export when external interchange is needed. Inspect partial
publication reports before retrying; an error may still contain issued IDs.
Publication also uploads retained local static props and TextureId overrides,
reuses existing numeric IDs and maps only the result clone to issued IDs.
Do not manually publish each dependency or rewrite the source model.

Use the existing Model, Skeleton/Bone, MeshPart, Humanoid, Animator and Animation
instances. A server Script loads the saved Animation and starts its AnimationTrack.
For timed falls and held ending poses, use the
[one-shot ending guidance](../character-animation/SKILL.md#one-shot-ending-poses).
For NPC travel, use Humanoid.MoveTo/MoveToFinished and coordinate WalkSpeed and
track playback with the authored motion. Apply changes Workspace but does not save the world;
persist it with `studiorpc_level_save_file`.

Runtime track time, evaluated skin and actor displacement establish different facts.
Contact comparisons need matching mesh/LOD/vertex IDs and fresh bone-transform revisions during
declared stance. Missing or unrefreshed samples are unmeasured. Native integrity success does not
certify visual quality, contact or loop continuity.
