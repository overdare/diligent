# Existing texture authoring paths

The texture-authoring skill guides the agent through existing Studio methods. It adds no Studio RPC method, rendering system, image publisher or storage format. Web and TUI use the same existing tools.

Diligent owns task interpretation, source-image prompts and orchestration. Studio owns supported scene properties, native asset import/publication, ordinary material rendering, save and play. The image generator creates source artwork; studiorpc_asset_manager_import must return the final published ovdrassetid used by the existing properties.

Basic Part uses Material/MaterialVariant. A MaterialVariant under MaterialService supplies ColorMap for repeated material mapping; MetersPerTile scaling requires a supported non-Unlit BaseMaterial, and ColorMap alpha is ignored. Basic Part has no existing MeshPart-style TextureId or independent six-face image path. Unsupported decoration must be reported rather than implemented with a new renderer, small decorative meshes or SurfaceGui.

MeshPart.TextureId supplies an image through existing UVs. ProceduralModel recipes own generated geometry and UVs; after baking, inspect actual children and match stable recipe part names before applying the image through those MeshParts. Rebuilds require a new read and verification of the current supported properties; there is no new automatic binding-restoration service.

Use schema discovery for unfamiliar fields and data types. Keep real source images and recipe files for edits, reuse published images deliberately, and inspect material assignment, pixels, save/reopen, rebake and actual gameplay. A successful import or property setter alone does not establish a complete visual result.

Texture resolution/LOD quality is a known issue owned by the team for a later fix. The engine texture LOD override is not part of this workflow; existing device profiles, mips and streaming determine the actual resolution. Source, cooked/allowed and resident dimensions may differ, and a 1024 source image does not establish 1024 rendering. Report observed limits and visual impact without resizing/reimporting artwork, changing engine settings or adding rendering workarounds to conceal the issue. Device memory, frame time and deployed cooked-world playback require target validation.
