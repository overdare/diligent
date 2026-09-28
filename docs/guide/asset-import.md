# Asset import

`studiorpc_asset_manager_import` imports an external image or 3D model into the OVERDARE asset manager.
It calls Studio's unified `asset_manager.import` method and returns the created asset ID.

```json
{
  "file": "C:/assets/prop.fbx",
  "assetName": "Prop"
}
```

`file` is required and must be an absolute path accessible to the Studio process. Supported model formats
are `fbx`, `obj`, `glb`, and `gltf`; image formats are `png`, `jpg`, `jpeg`, `tga`, `bmp`, and `exr`.
Extensions are case-insensitive. `assetName` is optional and names a 3D model; Studio uses the file name
when it is omitted.

A successful response contains `success: true` and `asset.file` plus `asset.assetid`, such as
`ovdrassetid://3528427`. Importing does not place the model into the level. The tool saves the level after
a successful RPC, consistent with the existing image import tool. Import failures propagate without a save.

The existing `studiorpc_asset_manager_image_import` tool still calls the legacy image method. The unified
tool requires a Studio build that supports `asset_manager.import` and does not retry unsupported requests
through a different import method.

For cross-machine development, the unified tool uses the same opt-in shared-path mapping as the image
tool. See [shared file roots](./mac-agent-windows-studio.md#image-import-during-cross-machine-development).
