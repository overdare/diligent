---
name: custom-character
description: Author non-ODA character geometry, skeletons, skin weights and motion, then publish and connect ordinary Lua character assets. Use for animals or custom skeletal characters; ODA costumes and ODA clip edits use their separate workflows.
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
data, using generated part names as regions. Do not emit executable rig or motion
recipes. Author anatomy, hierarchy, weights and motion for the requested character;
Studio builds and measures the supplied data without selecting a species or gait.

Authoring data uses Unreal Z-up centimetres and quaternion parent-local poses.
Lua uses Y-up coordinates. `animation.read/write` uses a different Euler delta-key
format; read that tool's contract before editing a clip through it.

## Choose review for the task

Build with `commit=false`; it saves a draft without automatically rendering review
captures. Choose the observations useful for the requested action and its risks:
silhouette, a selected joint deformation, contact, a loop boundary or travel.
Each `mode=observation` call captures only the selected preset if missing, or reads
its saved evidence. `refresh=true` recaptures any selected preset. Probe operations
use explicitly authored `observationBones` or `bendTestRegions`; missing selection
is unavailable, never inferred anatomy. There is no mandatory seven-capture or
fresh-process checklist. Revise with a new requestId; retries reuse frozen inputs.

When independent saved-source replay is useful and a local Studio checkout is
available, optionally use the Diligent-owned
[source proof runner](scripts/character-source-proof.py):

```sh
python character-source-proof.py --studio-root STUDIO_CHECKOUT verify-source --build-id BUILD_ID
```

The runner copies the saved draft into an isolated user directory, starts the
Studio binary and installs proof only if the original draft is unchanged. Pass
`--source-user-dir` when the source Studio uses a custom user directory. This is
optional external evidence, not a native commit, publication or apply requirement.
Commit the exact four draft revisions; Studio checks source and native asset
integrity. The caller decides the relevant review and acceptable visual quality.

## Publish and connect existing gameplay

Use `studiorpc_character_export(mode=publish)` for ordinary numeric asset IDs, then
explicit `studiorpc_character_build(mode=apply)` with the reviewed publication and
source graph revision. Recipe-only drafts lack inspected Workspace part identities
for apply. Use FBX export when external interchange is needed. Inspect partial
publication reports before retrying; an error may still contain issued IDs.

Use the existing Model, Skeleton/Bone, MeshPart, Humanoid, Animator and Animation
instances. A server Script loads the saved Animation and starts its AnimationTrack.
For NPC travel, use Humanoid.MoveTo/MoveToFinished and coordinate WalkSpeed and
track playback with the authored motion. Save, reopen and test the ordinary map.

Inspect client and authority runtime samples plus actual images. Track time,
evaluated bone/skin updates, visible heading and actor displacement establish
different facts. Compare matching mesh/LOD/vertex IDs during declared stance;
discard repeated bone-transform revisions. Missing contact samples are unmeasured.
Native measurements and optional source-replay `passed` do not approve artistic
quality, foot contact or loop continuity. Review those facts against the task.
Deployed client and remote-world publishing need evidence when requested.

The optional [native RPC client](scripts/character-tools.py) is for local transport
diagnostics with an explicitly selected Studio port; normal agent work uses the
bundled `studiorpc_character_*` tools.
