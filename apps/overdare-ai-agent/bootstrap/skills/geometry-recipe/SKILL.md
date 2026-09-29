---
name: geometry-recipe
description: Author and edit OVERDARE ProceduralModels — Python geometry recipes baked into MeshParts with material presets and tints. Use when creating a ProceduralModel or changing an existing one's recipe, Size, or attributes.
---

# OVERDARE geometry recipes

Write a Python recipe that builds a mesh and bakes it into a ProceduralModel as real
`MeshPart` children — solid geometry with material presets, tints, UV projection and a triangle
budget. Use it for custom 3D objects whose surfaces and silhouette matter — a crate, a bench, a
lantern, a barrel, a bookshelf — when primitive Parts are too simple and the Asset Store has nothing
that fits.

## Read the API first

Call `studiorpc_proceduralmodel_api` once at the start for a working template, material presets,
enums, and the available function names, then query it by name for signatures. Recipes use Unreal
Python (`import unreal`, `unreal.OvdrGeometry`, `ovdr_parts`), not Blender (`bpy`). Do not guess an
API from memory; if a function you need is not in the returned API, say so instead of inventing one.

Nothing is pre-injected into a recipe; include the imports it needs (`import unreal`,
`G = unreal.OvdrGeometry`, `import ovdr_parts as parts`, or `from ovdr_brickcolor import bc`).

## The contract — a recipe has one shape

A recipe is a Python module that declares its parameters and defines one entry point:

```python
OVDR_PARAMETERS = {"plank_count": 5}          # module level: knobs, constants, helper defs only

def on_generate(model, size, attributes):
    w, d, h = size                            # width, depth, height in cm, Unreal space (Z up)
    mesh = G.new_mesh()
    # ... build geometry ...
    model.part("crate_wood", mesh, "Plank", tint=bc("Dark orange"))
```

- The runner **refuses a module without `on_generate`** before executing a line of it, and refuses
  one whose `on_generate` does not take exactly `(model, size, attributes)`. Top-level code stays
  declarative — imports, constants, helper `def`s. Geometry belongs *inside* `on_generate`.
- `model.part(name, mesh, preset, tint=..., location_cm=(0,0,0), tile_cm=0)` turns the in-memory
  mesh into a MeshPart child. **One part per distinct `(preset, tint)` pair, never per body part** —
  a squirrel's body, head, ears and legs are all one fur, so they are one part. `G.append_mesh`
  everything that shares a material into one mesh first.
- `size` is the built-in `(width, depth, height)` in cm, in model-local Unreal coordinates (see
  below). Build to it and dragging the model's Size handle re-runs the recipe at the new footprint;
  ignore it and the handle does nothing.
- Validate inputs before emitting meshes: derived dimensions must stay positive after subtracting
  framing, gaps, or repeated layers, including when individually valid parameters combine.
- `attributes` are the parameters `OVDR_PARAMETERS` declares, by name. Declared struct types arrive
  as friendly Python values (a `Color` for Color3, a `Vector3`, a `UDim2`, a `CFrame`, …).

## Coordinate spaces

Native geometry operations and spatial inputs to the recipe use model-local Unreal coordinates:
centimetres, Z up. By default, author props facing +X with their base at z=0, unless the asset needs a
different orientation or origin.

- Studio supplies the built-in `size` argument as `(Editor Size.Z, Editor Size.X, Editor Size.Y)`, so
  recipe extents `(160, 45, 240)` need Editor Size `[45, 240, 160]`. Do not reorder `size` again inside
  the recipe.
- Use OVERDARE coordinates, Y up, for Luau scene placement, instance-read transforms, and viewport
  camera `position`/`lookAt`. Once the model is baked, place and script it in these coordinates; do not
  carry recipe axes into Luau.
- Identify the coordinate space of each spatial value, including whether a position is model-local or
  world space.
- Check a non-cubic result's dimensions and orientation. Model rotation changes orientation only; fix
  wrong dimensions or internal relationships in the recipe or its inputs.

## Never stack, loft

A form built by stacking boxes and cylinders reads as a pile of blocks: seams show at every joint and the
silhouette steps where it should curve. Shape each continuous form as one piece, carving its silhouette as
a whole, and keep separate pieces only for parts that really are separate, such as a crate's planks or a
lantern's handle.

## The loop

1. Read the API (`studiorpc_proceduralmodel_api`) and any existing recipe.
2. Write the recipe to a project file and check it with `studiorpc_proceduralmodel_validate`.
3. Bake with `studiorpc_proceduralmodel_set`: pass `name` (and optional `parentGuid`) to create the
   model, or `guid` to update one, along with `sourcePath`, `size`, `attributes`, and `rebuild: true`.
   Keep the returned `guid`.
4. Judge the returned bake report (see below), then photograph the model with
   `studiorpc_game_screenshot` `{ instanceId: <guid>, yaws: [35, 215] }`. See "Looking at the prop".
5. Fix the same recipe file and bake the same model again. To change only parameters, call
   `studiorpc_proceduralmodel_set` with just the changed `attributes` and `rebuild: true`. Ship when the
   numbers and the picture agree.

The ProceduralModel owns the recipe and renders it live; asset ids are issued at publish, not on each
pass.

## Repeating an object

Every distinct mesh is streamed separately, so many different meshes hurt performance. When the same
object repeats many times across a scene (dozens of fence posts, a street of lamps), bake one model and
place copies of it with `studiorpc_execute_luau`, grouped under one Folder or Model, instead of baking a
new model for each placement. A few repeats that belong to one object, such as a table's four legs,
stay inside that object's recipe.

## Judge on the numbers before the picture

`studiorpc_proceduralmodel_set` with `rebuild: true` returns the whole run: `parts`,
`modelBoundsCm`, `warnings`, `stdout`, and `error` on failure. Read it before the picture:

- `boundsCm` — the part's footprint. `parts.fits_within(mesh, x, y, z)` asserts it in-recipe.
- `triangles`, `tier`, `targetTriangles` — Studio picks each part's tier from its measured longest
  axis and reports that part's `targetTriangles`. A model-wide target, also set by size, covers total
  triangles and MeshPart count and appears in `warnings`. Targets are advisory: an over-target bake
  still succeeds with a warning, and a low count never warns. Aim near the target; under-spending is
  the common mistake, and a count far below it usually means detail was left out. A part's tier can be
  set explicitly to `S`, `M`, `L`, or `XL`; that changes only the part target, so do not use it to
  silence a model-wide warning.
- `warnings` — read every warning actually returned; missing diagnostics do not mean no warnings.
- On the preset (material) path, project UVs at the size the pattern was drawn for — each preset
  tiles at its own `LocalUVWscale`, and `model.part`'s `tile_cm` must land in 25–400 cm (a
  finer tile is refused, and would render as flat colour anyway). A 400 cm wall tiled every 20 cm
  is a grey field; the same wall at 128 cm reads as masonry.
- Use exact preset names from the API's `presets`; do not invent one from an appearance adjective.
  If a bake error names a preset, change that preset rather than unrelated valid ones.
- A changed recipe can keep child GUIDs, mesh ids, and outer bounds. Compare a shape or measurement
  that should have changed; unchanged identifiers do not show whether regeneration happened.

## Looking at the prop

The recipe does not render; the baked MeshParts do. Look at the returned image itself: a file path or
success flag is not visual evidence, and if the image cannot be read, report that. `studiorpc_game_screenshot` with an
`instanceId` renders that model alone — nothing else of the level in frame, fixed key light and
exposure, the creator's camera untouched — so two shots are comparable and you see the prop as it
ships. Steer the view without changing anything:

- `yaws: [35, 215]` — compass angles to orbit through, one PNG each (up to 8). The default camera
  sits on the recipe's +X / +Y side, so **build the prop facing +X, standing on z=0**; a face on
  -X / -Y is invisible in the default shot unless you pass the yaw that turns it into view.
- `pitch` — degrees above the horizon to look down from (default 20).

For a tighter or wider framing (zoom), the instance render frames automatically and has no
zoom option. When you need a specific distance or a detail
close-up, take the ordinary viewport shot instead and frame it host-side with the existing
`camera`: read the model's world bounds with `studiorpc_instance_read` (`WorldTransform` +
`Size`), then call `studiorpc_game_screenshot` with `camera: { position, lookAt }` — `lookAt` at
the bounds centre, `position` pulled back along your chosen yaw/pitch by a distance set from the
bounds radius and the field of view (nearer = tighter). This trades the fixed-light isolation of the
instance render for full control of direction and zoom.

## Gotchas that cost an iteration

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

## The recipe is a file

The recipe file is the source of truth; the baked MeshParts are derived output. Keep one recipe per prop
in a project file (e.g. `.overdare/geometry-recipes/ammo-crate.py`), not an OS temp directory, and preserve Python
indentation. Editing the file does not regenerate the model; bake again after each change. There is no
recipe `id`: keep the file path and model GUID, and do not invent a path for an existing model whose
Source was never saved to a file.
