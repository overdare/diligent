---
name: procedural-model-builder
description: Author a solid, textured 3D prop for OVERDARE by writing a Python geometry recipe that bakes real MeshParts with material presets and tints. Use for a single detailed asset — a crate, bench, lantern, barrel, weapon, bookshelf — that reads as one modelled object. Use Editor Luau directly for ordinary scene placement.
---

# OVERDARE geometry recipes

Write a Python recipe that builds a mesh and bakes it into a **ProceduralModel** as real
`MeshPart` children — solid geometry with material presets, tints, UV projection and a triangle
budget. This is the system for **one prop made well**: a crate, a bench, a lantern, a barrel, a
bookshelf. Ordinary scene placement can use Editor Luau directly. Reach for this one when the deliverable
is a single object whose surfaces and silhouette matter.

## Read the authoring reference first

Use the complete native Source reference in the system prompt and a working recipe
when available. Query `studiorpc_instance_schema_search` for class/property and
material hints; it does not describe Python geometry function signatures. Consult
applicable native API documentation for additional `G.*`, `parts.*` and `layout.*`
functions rather than guessing an API from memory.

Start from a complete, working template or the model's existing working recipe.
Copy the template and change its marked EDIT sections when present; otherwise
limit changes to the requested generation rules, parameters and materials. Keep
its validated imports, entry point, error checks and mesh cleanup unless the
change requires modifying them. Do not rebuild a working recipe from scratch.

The original material reference uses `Rust` / `RustySteel` for iron-like weathered
surfaces and `Plank` for sawn timber. These are selection examples, not defaults
for every surface. Use the current material hints and native reference to confirm
supported names; do not invent `Iron` or `Steel` from an appearance description,
or copy the template's Plank onto unrelated surfaces without choosing a material.

Nothing is pre-injected into a recipe; include the imports it needs (`import unreal`,
`G = unreal.OvdrGeometry`, `import ovdr_parts as parts`, or `from ovdr_brickcolor import bc`).

## The contract — a recipe has one shape

A recipe is a Python module that declares its parameters and defines **one** entry point:

```python
OVDR_PARAMETERS = {"plank_count": 5}          # module level: knobs, constants, helper defs only

def on_generate(model, size, attributes):
    w, d, h = size                            # the model's Size in cm, Z up
    mesh = G.new_mesh()
    # ... build geometry ...
    model.part("crate_wood", mesh, "Plank", tint=bc("Dark orange"))
```

- The runner **refuses a module without `on_generate`** before executing a line of it, and refuses
  one whose `on_generate` does not take exactly `(model, size, attributes)`. Top-level code stays
  declarative — imports, constants, helper `def`s. Geometry belongs *inside* `on_generate`.
- `model.part(name, mesh, preset, tint=..., location_cm=(0,0,0), tile_cm=0)` turns the in-memory
  mesh into a MeshPart child. **One part per distinct `(preset, tint)` pair, never per body part** —
  a squirrel's body, head, ears and legs are all one fur, so they are **one** part. `G.append_mesh`
  everything that shares a material into one mesh first.
- `size` is the built-in `(width, depth, height)` in cm, Z up. Build to it and dragging the model's
  Size handle re-runs the recipe at the new footprint; ignore it and the handle does nothing.
- `attributes` are the parameters `OVDR_PARAMETERS` declares, by name. Declared struct types arrive
  as friendly Python values (a `Color` for Color3, a `Vector3`, a `UDim2`, a `CFrame`, …).

Check the Python contract after writing or editing Source. Do not use the gameplay
Lua validator for this Python module. Editor execution is not a synchronous bake
validation report; inspect the generated result and available diagnostics later.

## The loop

1. Read the native Source reference and any existing recipe; inspect the target's
   class/property hints when needed.
2. Keep the Python recipe in a project file and check its contract. Through
   `studiorpc_execute_luau` with `target: "Editor"`, create and parent a ProceduralModel,
   assign the file's complete text to Source, set Size/attributes and enable AutoRebuild.
   Editor Size is `[x, y, z]`, Y up; the tested native size tuple is `(Editor Z, Editor X, Editor Y)`.
3. Resolve and keep the model GUID with focused browse/readback. Read generated
   MeshParts in a later call: Editor saves successful edits, but generation is
   asynchronous. Do not call unsupported Rebuild/Bake methods or replay creation.
4. Use `studiorpc_game_screenshot` with `{ instanceId: <guid>, yaws: [35, 215] }`
   to inspect the model. See "Looking at the prop" below.
5. Fix the same recipe/model and synchronize changed file text to Source. Test
   AutoRebuild by changing an attribute after the initial command ends without
   resubmitting Source, then observe the result. Ship when the measured result and
   the picture agree; save subsequent generated changes if needed.

The ProceduralModel owns the generation Source and renders it live; asset ids are
issued at publish, not on each pass. An Editor return is authored by your code, not
an automatic report of the later bake.

## Judge on the numbers before the picture

Use observed part data or native diagnostics when available. The Editor tool does
not return the old dedicated bake report; do not invent its fields when unavailable:

- `boundsCm` — the part's footprint. `parts.fits_within(mesh, x, y, z)` asserts it in-recipe.
- `triangles` — under 30,000; **under-spending is the common mistake**, not overspending. Set
  dressing 1,000–4,000, a pickup 1,500–6,000. A tenth of the budget usually means detail was left
  out.
- `warnings` — read every warning actually returned; missing diagnostics do not mean no warnings.
- On the **preset (material) path**, project UVs at the size the pattern was drawn for — each preset
  tiles at its own `LocalUVWscale`, and `model.part`'s `tile_cm` must land in **25–400 cm** (a
  finer tile is refused, and would render as flat colour anyway). A 400 cm wall tiled every 20 cm
  is a grey field; the same wall at 128 cm reads as masonry.

## Looking at the prop

The recipe does not render; the baked MeshParts do. `studiorpc_game_screenshot` with an
`instanceId` renders **that model alone** — nothing else of the level in frame, fixed key light and
exposure, the creator's camera untouched — so two shots are comparable and you see the prop as it
ships. Steer the view without changing anything:

- `yaws: [35, 215]` — compass angles to orbit through, one PNG each (up to 8). The default camera
  sits on the **+X / +Y** side, so **build the prop facing +X, standing on z=0**; a face on -X / -Y
  is invisible in the default shot unless you pass the yaw that turns it into view.
- `pitch` — degrees above the horizon to look down from (default 20).

For a **tighter or wider framing (zoom)**, the instance render frames automatically; there is no
zoom knob and adding one would change the RPC. When you need a specific distance or a detail
close-up, take the ordinary viewport shot instead and frame it host-side with the existing
`camera`: read the model's world bounds with `studiorpc_instance_read` (`WorldTransform` +
`Size`), then call `studiorpc_game_screenshot` with `camera: { position, lookAt }` — `lookAt` at
the bounds centre, `position` pulled back along your chosen yaw/pitch by a distance set from the
bounds radius and the field of view (nearer = tighter). This needs no spec change; it trades the
fixed-light isolation of the instance render for full control of direction and zoom.

## Gotchas that cost an iteration (the reference has the full list)

- **Grooves and holes are shapes, not textures.** There is one albedo map, no normal map and no
  opacity. A cut groove reads as nothing — raise a rib (`parts.rib`). A defining perforation is
  `parts.perforated_tube`; a one-off opening is a boolean subtract. Glass is a thin solid with the
  `Glass` preset — nothing shows through it.
- **One material is one mesh, so a material boundary must be a part boundary.** "Moss below the
  water line, dry stone above" is two parts split at that height, not one textured mesh.
- **256 live mesh handles.** Build one element, `append_mesh` it wherever it repeats, dispose the
  source. Merge as you go — collecting parts in a list and merging at the end runs out on anything
  repeated (tiles, bricks, books, balusters). The `template` merges as it goes for this reason.
- **Every sign error in this API is silent** — no error, no warning, no changed number. Prefer
  `parts.orient(at, z_toward=..., x_toward=...)` over hand-picked pitch/yaw/roll, and never copy a
  rotation between two calls that need different orientations.
- **`G.*` returns `False` instead of raising** — wrap each call in a `ck(...)` that raises on
  `False` (the template ships one). `parts.*` and `layout.*` are ordinary Python and do raise.
- **Enums are objects**: `unreal.OvdrOriginMode.BASE`, `unreal.OvdrAxis.Z`,
  `unreal.OvdrBooleanOp.SUBTRACT`. The report prints a default as a bare string like `"Base"`,
  which is not what you type.

## Storing recipes — the recipe is a file

Keep one semantic recipe per prop, **in a file**, and iterate on that file. A recipe is the source of
truth; the baked MeshParts are derived output. This is the default loop:

1. Write the recipe to a file in the project (a plain path you choose, e.g.
   `geometry-recipes/ammo-crate.py`). Not an OS temp directory.
2. Read that file and assign its contents to the same model's Source through Editor
   Luau. A project file edit alone does not regenerate the Studio model; Editor
   execution takes Luau code, not a sourcePath argument.
3. To change something, edit the project file and synchronize Source. Focused
   `studiorpc_script_read` / `studiorpc_script_edit` can inspect or patch model Source
   by GUID, but keep the project file synchronized. Preserve Python indentation.

There is **no recipe `id` and no namespaced copy** of the source: keep the actual
project file path and model GUID for iteration. Do not invent a path for an existing
model whose Source has not been saved to a project file.
