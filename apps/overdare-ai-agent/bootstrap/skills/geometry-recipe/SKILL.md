---
name: geometry-recipe
description: Author a solid, textured 3D prop for OVERDARE by writing a Python geometry recipe that bakes real MeshParts with material presets and tints. Use for a single detailed asset — a crate, bench, lantern, barrel, weapon, bookshelf — that reads as one modelled object. Not for laying out a scene from primitive blocks; that is procedural-builder (studiorpc_procedural_run).
---

# OVERDARE geometry recipes

Write a Python recipe that builds a mesh and bakes it into a **ProceduralModel** as real
`MeshPart` children — solid geometry with material presets, tints, UV projection and a triangle
budget. This is the system for **one prop made well**: a crate, a bench, a lantern, a barrel, a
bookshelf. It is a different system from `procedural_builder` / `studiorpc_procedural_run`, which
assembles a scene out of primitive `Part` blocks in Luau. Reach for this one when the deliverable
is a single object whose surfaces and silhouette matter.

## The one rule that saves you: read the live API first

`studiorpc_proceduralmodel_api` returns the authoring reference, current and self-describing. Call it
**once** at the start of a prop and work from what it returns — it is the source of truth, not this
file. The default reply is the **compact kit** (small on purpose — you never read or grep a file):

- `template` — a complete, working recipe. Copy it and change its marked `EDIT` blocks.
- `lookup` — every `G.*` / `parts.*` / `layout.*` signature on one line, keyed exactly as you write it
  in code (`lookup["G.place"]`, `lookup["parts.orient"]`).
- `presets` — the ~94 material preset names, asked of the material service so they cannot drift.
  There is **no** `Iron`, `Steel`, `Stone`, `Leather` or `Rope`: iron is `Rust` / `RustySteel`,
  sawn timber is `Plank`. A wrong name is refused, not rendered grey.
- When a call's exact arguments or a returned number look wrong, call it **again with `query`**
  (names/keywords, e.g. `query=["append_sphere","rib","bounds"]`) to get the verbose per-argument
  docs and notes for just those calls. Do not dump the whole reference to hunt one signature.

Nothing is pre-injected into a recipe; the imports it needs (`import unreal`, `G =
unreal.OvdrGeometry`, `import ovdr_parts as parts`, `from ovdr_brickcolor import bc`) are all in
`template`. Do not guess an API from memory when `lookup` has the exact signature.

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

Run `studiorpc_proceduralmodel_validate` (`code` = the recipe, or `sourcePath` = a recipe file) after writing
or editing it: it checks the contract shape without a bake, so a slip is caught in milliseconds.

## The loop

1. **`studiorpc_proceduralmodel_api`** once. Read `template`, copy it, change the `EDIT` blocks.
2. **`studiorpc_proceduralmodel_validate`** with the recipe `code` (or `sourcePath` = a recipe file). Fix any
   findings — cheaper than a bake.
3. **`studiorpc_proceduralmodel_set`** creates the model *and* bakes it in one call:
   `{ name, parentGuid?, source | sourcePath, size, attributes?, rebuild: true }`. Omit `guid` and pass
   `name` to create a new `ProceduralModel` (parent defaults to Workspace) — the reply returns its
   `guid`; **keep it** to iterate. Pass the recipe inline as `source` or point at a file with
   `sourcePath`. The reply carries the whole run — `parts` (triangles, boundsCm, tint, tier),
   `modelBoundsCm`, `warnings`, `stdout`, and on failure `error`. **Judge the numbers first.**
4. **`studiorpc_game_screenshot`** with `{ instanceId: <guid>, yaws: [35, 215] }` once the numbers
   are clean, to see it. See "Looking at the prop" below.
5. Fix and re-bake the **same** model: `studiorpc_proceduralmodel_set` with
   `{ guid, source | sourcePath, size, rebuild: true }`. Ship when the numbers and the picture agree.

There is no separate draft or "execute": the ProceduralModel owns the recipe and renders it live;
asset ids are issued at publish, not on each pass.

## Judge on the numbers before the picture

The `parts` and top-level fields in the run report catch most mistakes without a screenshot:

- `boundsCm` — the part's footprint. `parts.fits_within(mesh, x, y, z)` asserts it in-recipe.
- `triangles` — under 30,000; **under-spending is the common mistake**, not overspending. Set
  dressing 1,000–4,000, a pickup 1,500–6,000. A tenth of the budget usually means detail was left
  out.
- `warnings` — read every one; they are top-level on the result, not per mesh.
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
2. Validate and bake by passing **`sourcePath`** to `studiorpc_proceduralmodel_validate` and
   `studiorpc_proceduralmodel_set` — the file is read host-side, so **you never re-send the recipe
   you already wrote**. That is the point: it is far cheaper than pasting the whole source on every
   pass.
3. To change something, **edit the file** (`studiorpc_script_edit` for a small fix) and re-bake with
   the same `sourcePath`.

Pass the whole recipe inline — `source` to bake, `code` to validate — only for a throwaway or the
very first draft. There is **no recipe `id` and no namespaced copy** of the source: the file path is
the recipe's identity. Don't invent an id or a placeholder for one.
