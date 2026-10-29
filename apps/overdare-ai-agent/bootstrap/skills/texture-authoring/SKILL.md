---
name: texture-authoring
description: Use OVERDARE's existing published-image, MaterialVariant and MeshPart TextureId paths for surface artwork. Read before generating or applying a texture to a Part or ProceduralModel.
---

# Existing texture paths

Use existing Studio tools and supported properties. Basic Part and MeshPart have different texture paths; inspect the actual target class and current material before choosing one.

| Target | Existing path | Constraint |
|---|---|---|
| Basic Part | MaterialVariant under MaterialService; set ColorMap and the Part's Material/MaterialVariant | Repeating material; MetersPerTile scaling requires a supported non-Unlit BaseMaterial. It does not provide independent images on six faces. ColorMap alpha is ignored. |
| MeshPart | Set its TextureId to a published image | Placement follows the mesh UVs. Inspect the UV layout and actual rendering. |
| ProceduralModel | Generate geometry/UVs with the current recipe API, then use its baked MeshParts' existing TextureId | Re-read baked children after rebuilds; match stable recipe part names and verify/reapply supported properties when needed. |

1. Read the target, related material and existing recipe. Query unfamiliar fields and types through the live instance schema; do not invent a TextureId field on basic Part or a Decal/Texture class.
2. Choose existing material/color for simple surfaces. Generate source artwork only when the task needs a new image, using the configured GPT image tool and appropriate references. For repeating materials, request a seamless texture without perspective, baked shadows or unwanted text. Use the smallest resolution that remains clear at player distance, up to the requested 1024 albedo ceiling; streaming can use smaller mips.
3. Import a generated file through studiorpc_asset_manager_import. The absolute path must be accessible to Studio. Retain the returned asset.assetid and require a real numeric ovdrassetid URI. A local PNG, an accepted request or an upload timeout does not establish publication. Inspect unknown outcomes before retrying.
4. Apply the published image through the appropriate existing property path above. Use studiorpc_execute_luau for supported Editor edits; workspace/game.Workspace and direct service children are available, while game:GetService, task, os and isnil are not. Successful mutation tools already save; inspect a save failure before replaying any mutation.
5. Read back the asset reference and material assignment. Inspect the actual editor and play images for UV placement, tile scale, orientation, seams and visual quality. Save/reopen and rebake where relevant. Image reuse should preserve the same published reference where the task calls for it.

If the requested face placement or nonrepeating decoration has no supported existing path on a basic Part, report that limitation and continue the supported work. Do not add geometry letters, decorative MeshParts, SurfaceGui, a new renderer or a custom storage/binding system to emulate it. Do not convert a primitive into a mesh solely to bypass this limit. A real custom 3D object may use the existing procedural geometry workflow when its shape calls for it.

Keep original artwork and recipe sources in the task's files for future edits. No native painting document, per-face atlas service or automatic binding restoration is implied. Other material channels, alpha behavior and resolution limits remain subject to the existing material and importer; verify them rather than assuming support.
