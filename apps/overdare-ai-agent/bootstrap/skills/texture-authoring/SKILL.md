---
name: texture-authoring
description: Generate or apply surface artwork using existing OVERDARE material and MeshPart texture paths.
---

# Existing texture paths

The target class and current material determine the supported image path.

| Target | Existing path | Constraint |
|---|---|---|
| Basic Part | MaterialVariant under MaterialService; set ColorMap and the Part's Material/MaterialVariant | Repeating material; MetersPerTile scaling requires a supported non-Unlit BaseMaterial. It does not provide independent images on six faces. ColorMap alpha is ignored. |
| MeshPart | Set its TextureId to a published image | Placement follows the mesh UVs. |
| ProceduralModel | Generate geometry/UVs with the current recipe API, then use its baked MeshParts' existing TextureId | Rebuilds can replace children or properties; resolve current children by stable recipe part name. |

ProceduralModel supports a UV atlas through this same path: map each geometry group into its image
rectangle with `fit_uvs_to_rect`, leave gutters, then merge groups sharing the atlas and assign one
published TextureId. This is mesh UV mapping, not an independent face-image path for basic Part.

Use material/color for simple surfaces and the configured image generator when new artwork is needed.
Repeating artwork should be seamless and free of perspective or baked lighting. Keep image and recipe
sources for future edits. UV orientation, tile scale, stretching and mip bleed depend on the rendered result.

Import artwork with `studiorpc_asset_manager_import` using an absolute path accessible to Studio.
The returned `asset.assetid` must be a numeric `ovdrassetid://N` before it is used by these properties;
a local file or timed-out request is not a published asset. Resolve an unknown upload outcome before retrying.
Apply through supported Editor properties with `studiorpc_execute_luau`; its API and save behavior are
described by that tool. Reuse the same published image when the artwork is shared.

If basic Part cannot support the requested nonrepeating decoration, explain the limit. Keep the
existing material/mesh workflow rather than emulating surface artwork with small geometry, SurfaceGui
or a new renderer/binding system. Use procedural geometry when the requested object needs custom 3D shape.

Texture resolution/LOD quality is a known issue for the team to fix. Existing engine profiles, mips and streaming determine the actual result; there is no guaranteed native 1024 override. Report observed resolution limits and their visual impact. Do not resize/reimport artwork, change engine settings or add rendering workarounds to conceal this issue.
