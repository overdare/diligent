---
name: custom-character
description: Create arbitrary non-ODA creatures with agent-authored geometry, skeletons, weights and motion, then play their asset IDs in an ordinary Lua game. Use for animals or custom skeletal characters; ODA costumes and ODA clip edits use their separate workflows.
---

Read `studiorpc_proceduralcharacter_api` before authoring. Read `studiorpc_proceduralmodel_api`
for geometry functions rather than guessing signatures. The agent writes anatomy, bone
hierarchy, skin weights and parent-local motion keys. The tool imports and evaluates
those data; it does not choose a species or invent a gait.

Create a Python `on_generate(model, size, attributes)` recipe. Emit named geometry
parts, `rig.json` and `motion.json` using the live contract. Respect the declared
coordinate spaces: authoring uses Unreal Z-up centimetres; Lua uses Y-up centimetres.
Use `authored_v1` for both rig and motion and hash the exact UTF-8 source bytes.

An existing ProceduralModel can supply the recipe: use
`source: {kind: "procedural_model", guid: "MODEL_GUID"}` in the same build tool.
Studio captures its Source, Size and declared typed attributes on the first request.
The recipe still needs explicit rig weights and motion; a geometry-only recipe is
not automatically rigged. Record `OVDR_PARAMS["attributes"]` in `rig.json.parameters`
and `OVDR_PARAMS["size"]` in `rig.json.size` to preserve the exact serialized types
and recipe-axis dimensions. Numeric overrides are merged over the captured attributes.
Retries and commit reuse the saved snapshot without reading or changing the model.
Use a new request ID to capture changed source, dimensions or attributes.

For a normally imported static Model, inspect it with `mode=source` first. Use the
returned `source: {kind: "static_model", guid, geometryRevision}` in the same build
tool, supply the authored rig as `rig` and authored motion as `motion.document`.
Use part GUIDs as rig region keys and the inspection's final vertex IDs for explicit
weights; positions use the common Model frame in Unreal Z-up centimetres. Built
sources use exact rendered LOD0, including importer-generated normals. Static
geometry executes no recipe and accepts no recipe overrides. A changed inspected
revision is rejected before binding. The saved Bundle preserves the geometry's
vertex layout, part provenance and generated material references. Inspect the
live API for schema details and input limits. ODA FBX animation import is unchanged.

Call `studiorpc_proceduralcharacter_build` with `commit=false`. Inspect actual rendered
images from `studiorpc_proceduralcharacter_inspect` with `mode=observation`, weights and measured motion.
Check silhouette, joint deformation, contact, loop continuity and the requested action.
A saved draft is not a quality verdict. Revise using a new request ID as needed.
Run the public runner's `verify-source` command in a fresh process,
then commit the exact source, geometry, rig and animation revisions that were reviewed.
This verifies authoring source only. Final assets use the existing normal import/upload
pipeline and require the saved-map Lua runtime checks below; do not add a private cooker.
Preserve existing characters by creating a separate target unless replacement was requested.

Open an ordinary map and stop PIE. Export the exact reviewed revisions with
`studiorpc_proceduralcharacter_export`. It uses the existing FBX exporter; external
interchange may combine meshes sharing one Skeleton. Internal part assets remain
in memory and do not require an intermediate import file. Pass the returned FBX
to the existing `studiorpc_asset_manager_import`. It normally places the imported model under Workspace.
Inspect that hierarchy first; use `studiorpc_asset_drawer_import` with the real numeric
`ovdrassetid://` MODEL ID only if it is absent. Avoid placing a duplicate. Inspect the
existing Model, MeshPart, Skeleton, Humanoid, Animator and Animation instances.
Do not use local ID tables as the final asset or create another runtime system.

Add a server Script that finds the saved Workspace model and uses the existing
Animator.LoadAnimation, Animation.AnimationId and AnimationTrack.Play APIs.
Save and play. Read `studiorpc_proceduralcharacter_inspect` with `mode=runtime` on client and authority.
The imported custom mesh/skeleton must be present, time must advance and bone poses
must change. Parent-local poses show animation keys; component/world poses include
existing Bone customization and are the evidence for rendered root alignment. Verify pause/speed/stop/restart when relevant. Reopen the saved map and
repeat. Inspect a screenshot as well as runtime measurements.
For a moving NPC, drive the existing Humanoid from a server Script with MoveTo and
MoveToFinished. Wait for its RootPart binding, set WalkSpeed to the authored motion
speed, and start/stop the existing AnimationTrack with movement and arrival. Observe
HumanoidRootPart displacement and target arrival on client and authority with
studiorpc_game_observe; changing poses alone do not prove movement. Do not repeatedly
assign HumanoidRootPart Position/CFrame as a movement loop.

Check heading as well as displacement. The v1 authoring travel/contact verification
uses mesh-space +X forward and Unreal +Z up; keep authored geometry, rig and motion
in that basis. The existing gameplay character mesh has a -90-degree Unreal Z
rotation and expects mesh-space +Y forward. Align the imported +X rig through its
existing root Bone.CFrame. Save and reopen to prove root alignment persists. Inspect
component/world bone transforms, rather than parent-local animation poses, for this.
Remote world publishing and a deployed client require their own evidence.
