---
name: geometry-recipe
description: Author detailed, textured or parameter-driven geometry with native ProceduralModel Python Source, real MeshPart children, material presets, tints and UV projection. Use for coherent modeled assets whose form and surfaces matter. Create and edit through Editor Luau, then verify automatic regeneration and the rendered result.
---

# OVERDARE geometry recipes

Build native **ProceduralModel** assets whose Python Source generates real
MeshPart children. Preserve generation rules and editable parameters so changes
produce related forms. This skill provides geometry authoring guidance; the actual
world editing entry point is `studiorpc_execute_luau` with `target: "Editor"`.
Ordinary one-time placement of existing objects does not require a generator.

## Establish the authoring contract

Read the system prompt's complete native Source example and reuse a working Source
when available. Native generation uses `import unreal`, `unreal.OvdrGeometry`, and
`ovdr_parts`; it does not use Blender. Consult applicable OVERDARE documentation
for additional `G.*`, `parts.*`, or `layout.*` signatures before using them.

Query `studiorpc_instance_schema_search` for ProceduralModel properties and any
unfamiliar instance material values using the supported class/property filters.
JSON property schemas do not document
native Python function arguments and may omit Source, which the documented Editor
path can still read and assign. Do not invent an API after an unrelated search hit
or replace Editor behavior with a gameplay Script.

## Native Source contract

- Declare defaults in `OVDR_PARAMETERS` and implement
  `on_generate(model, size, attributes)`. Keep module scope declarative: imports,
  constants and helper definitions. Generate meshes inside `on_generate`.
- Use the complete working module in the system prompt as a starting point. It
  demonstrates mesh creation, normals, append operations, UV projection, handle
  disposal and `model.part`; adapt its rules and materials to the requested form.
- `model.part(name, mesh, preset, tint=..., location_cm=(0,0,0), tile_cm=0)` declares
  a generated MeshPart. Merge geometry sharing a `(preset, tint)` pair with
  `G.append_mesh` before declaring its part. A material boundary requires a part
  boundary; do not make a separate MeshPart for every repeated component.
- `size` uses native `(width, depth, height)` in centimetres with Z up. Editor
  Size.Y is vertical. In the tested Studio mapping, the native tuple corresponds
  to `(Editor Size.Z, Editor Size.X, Editor Size.Y)`. Check non-cubic proportions
  and orientation rather than assuming the horizontal axes are interchangeable.
- Consume Size and the declared attributes in the generation rules; storing an
  unused parameter does not make geometry adjustable. Validate positive derived
  dimensions after subtracting framing, clearances, gaps and repeated layers.
- Keep randomness deterministic with an explicit seed when repeatability matters.

## Model and material quality

Use geometry for defining grooves, ribs, holes and silhouette changes instead of
assuming a tint or texture supplies the form. Check the available native functions
for the required operation; do not guess arguments for bevels, orientation or CSG.

Choose exact supported material preset names and normalized `unreal.LinearColor`
tints. The example's Plank is one working preset, not a required material for every
surface. Instance material enums help identify names, but do not establish every
argument accepted by native `model.part`.

Apply UV projection at the intended material scale. The native preset guidance
uses `tile_cm` in the 25-400 cm range. The earlier geometry implementation's
resource guidance is a ceiling of 256 live mesh handles and fewer than 30,000
triangles; verify current limits if newer Studio documentation differs. Reuse and
append repeated geometry, disposing temporary handles as you go. Do not accumulate
all temporary meshes until the end or spend triangles that do not improve the form.

Check boolean failure returns from `G.*` operations and surface
`G.get_last_error()` where available. Python helpers may raise exceptions. Native
Unreal enum values are objects, not the bare strings printed in some references.

## Author and iterate in the Editor

1. Establish the target parent and reuse an existing model when iterating. Read a
   supplied GUID to confirm the specific object; avoid rescanning the whole world.
2. Through Editor Luau, create and parent a ProceduralModel, enable AutoRebuild,
   assign its complete Python Source, set Size and initialize declared attributes.
   Resolve the resulting GUID with focused readback/browse. Do not invent GUID
   lookup, Rebuild or Bake methods in the Editor VM.
3. Successful Editor execution saves its edits, but generation is asynchronous.
   Read the generated children in a later call. Assignment success is not a bake
   report, and an empty result alone does not identify the cause of failure.
4. Change one parameter after the initial command has ended, without resubmitting
   Source, and observe the expected geometric change. Restore the test value when
   it was only a verification probe. Compare a relevant measurement or appearance;
   unchanged child GUIDs and outer bounds do not establish regeneration failure.
5. Make fixes to the same model's rules or inputs. Generated children are derived
   output, so direct child edits may be overwritten by the next regeneration.
6. Inspect the visible result before reporting completion. Save later generated
   changes when needed; do not replay creation to recover a failed save.

## Source ownership

For an existing model, read its Source and use focused `studiorpc_script_read` /
`studiorpc_script_edit` for small text changes, preserving Python indentation.
Editor Luau can assign the complete module when necessary. Do not validate this
Python module with the gameplay Lua validator.

If the user provides or requests a project recipe file, keep that file and the
model's Source synchronized and report its path. A file edit alone does not trigger
Studio generation: the revised text must reach Source. Editor execution accepts
Luau code, not a recipe file-path parameter. Otherwise, report Source on the model
as the persistent recipe rather than inventing a file or recipe identifier.

## Inspect and report evidence

Use `studiorpc_game_screenshot` with `instanceId` for an isolated model render;
`yaws` and `pitch` select useful views. For custom viewport framing, inspect
WorldTransform and Size when available and use the screenshot tool's camera
position/lookAt controls. They are observations for framing, not writable fields.
Actually view the image. If a Windows path is unreadable on the host, use its
mounted project counterpart when available or report that visual inspection failed.

Check part/material grouping, silhouette, proportions, UV scale and the effect of
parameters. Report triangle counts, bounds, native errors and warnings only when
those values were actually returned or measured. The shared Editor tool does not
supply the former dedicated bake report. Unknown diagnostics remain unknown; do
not turn missing warnings into "no warnings" or identical measurements into a
successful change claim.
