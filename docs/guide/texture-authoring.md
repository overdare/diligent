# Existing texture authoring paths

The texture-authoring skill guides the agent through existing Studio methods. It adds no Studio RPC method, rendering system, image publisher or storage format. Web and TUI use the same existing tools.

Diligent owns task interpretation, source-image prompts and orchestration. Studio owns supported scene properties, native asset import/publication, ordinary material rendering, save and play. The image generator creates source artwork; studiorpc_asset_manager_import must return the final published ovdrassetid used by the existing properties.

Basic Part uses Material/MaterialVariant. A MaterialVariant under MaterialService supplies ColorMap for repeated material mapping; MetersPerTile scaling requires a supported non-Unlit BaseMaterial, and ColorMap alpha is ignored. Basic Part has no existing MeshPart-style TextureId or independent six-face image path. Unsupported decoration must be reported rather than implemented with a new renderer, small decorative meshes or SurfaceGui.

MeshPart.TextureId supplies an image through existing UVs. ProceduralModel recipes own generated geometry and UVs; after baking, inspect actual children and match stable recipe part names before applying the image through those MeshParts. Rebuilds require a new read and verification of the current supported properties; there is no new automatic binding-restoration service.

Use schema discovery for unfamiliar fields and data types. Keep real source images and recipe files for edits, reuse published images deliberately, and inspect material assignment, pixels, save/reopen, rebake and actual gameplay. A successful import or property setter alone does not establish a complete visual result.

The requested World albedo ceiling is 1024 through existing Android/iOS device-profile settings, with mips and streaming enabled. Source, cooked/allowed and resident dimensions may differ. Device memory, frame time and deployed cooked-world playback require target validation.
