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
images from `studiorpc_proceduralcharacter_observe`, weights and measured motion.
Check silhouette, joint deformation, contact, loop continuity and the requested action.
A saved draft is not a quality verdict. Revise using a new request ID as needed.
Run the public runner's `verify-source` and `verify-cooked` commands in fresh processes,
then commit the exact source, geometry, rig and animation revisions that were reviewed.
Preserve existing characters by creating a separate target unless replacement was requested.

Open an ordinary map, stop PIE and call `studiorpc_proceduralcharacter_install`.
It saves map-local `/User` dependencies and the ID table. Add the `runtimeLuaModuleSource`
returned by the API as a ModuleScript. A server Script should call `Character.create`
with the returned `meshId` and `skeletonId`, then `Character.play` with `animationId`.
This uses the normal custom Skeleton + MeshPart + Humanoid/Animator runtime.

Save and play. Read `studiorpc_proceduralcharacter_runtime` on both client and authority.
Compare samples: the actual generated mesh and skeleton must be present, animation time
must advance and bone poses must change. Verify pause/speed/stop/restart when relevant.
Reopen the saved map and repeat. Inspect a screenshot as well as runtime measurements.
`proceduralcharacter.showcase` is a native diagnostic preview and is not this Lua proof.
Remote publishing and a deployed client require their own evidence; local IDs are scoped
to the installed map and do not imply an uploaded marketplace asset.
