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

Call `studiorpc_proceduralcharacter_build` with `commit=false`. Inspect actual rendered
images from `studiorpc_proceduralcharacter_inspect` with `mode=observation`, weights and measured motion.
Check silhouette, joint deformation, contact, loop continuity and the requested action.
A saved draft is not a quality verdict. Revise using a new request ID as needed.
Run the public runner's `verify-source` and `verify-cooked` commands in fresh processes,
then commit the exact source, geometry, rig and animation revisions that were reviewed.
Preserve existing characters by creating a separate target unless replacement was requested.

Open an ordinary map and stop PIE. Export the exact reviewed revisions with
`studiorpc_proceduralcharacter_export`. Pass the returned FBX to the existing
`studiorpc_asset_manager_import`. It normally places the imported model under Workspace.
Inspect that hierarchy first; use `studiorpc_asset_drawer_import` with the real numeric
`ovdrassetid://` MODEL ID only if it is absent. Avoid placing a duplicate. Inspect the
existing Model, MeshPart, Skeleton, Humanoid, Animator and Animation instances.
Do not use local ID tables as the final asset or create another runtime system.

Add a server Script that finds the saved Workspace model and uses the existing
Animator.LoadAnimation, Animation.AnimationId and AnimationTrack.Play APIs.
Save and play. Read `studiorpc_proceduralcharacter_inspect` with `mode=runtime` on client and authority.
The imported custom mesh/skeleton must be present, time must advance and bone poses
must change. Verify pause/speed/stop/restart when relevant. Reopen the saved map and
repeat. Inspect a screenshot as well as runtime measurements.
Remote world publishing and a deployed client require their own evidence.
