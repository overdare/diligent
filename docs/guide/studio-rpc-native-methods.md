# Native Studio RPC tools

The OVERDARE bundled Studio tool provider serves the Web runtime and the MCP server with the same
argument validation, approval, write serialization, and error mapping. Connected clients consume
the resulting tool output through their existing tool rendering paths.

## Approval

Generic method tools ask for `execute` approval before reaching Studio unless their method module
declares `export const readOnly = true`. Read-only methods only report Studio state and run without
a prompt:

- `game.settings.read`, `instance.schema.search`
- `game.character.read`, `game.observe`, `viewport.camera.read`, `level.browse`
- `game.screenshot` (writes only its PNG capture; a one-shot `camera` is restored after capture)
- `proceduralmodel.api`, `proceduralmodel.validate` (static recipe check; never touches the scene)

Everything else stays gated: methods that edit or save the level, import assets, change game
settings, aim the camera, start or stop play, write draft recipes (`proceduralmodel.run`), and
`hub.token.read`, which returns a secret. A method must not be both read-only and in
`mutatingMethods` or `serialize`d. Custom read tools (`studiorpc_instance_read`,
`studiorpc_script_read`, `studiorpc_script_grep`) never prompt; custom write tools request their own
`write` or `execute` approval.

## Schema-guided instance editing

`studiorpc_instance_schema_search` annotates inherited `Mobility` properties with the Editor Luau
enum type: use `Enum.MobilityMode.Static` or `Enum.MobilityMode.Movable` on direct Workspace children.
The Studio schema lists enum values but does not supply the enum type name.

## Unified asset import

Use `studiorpc_asset_manager_import` for image, model, and audio files. Studio selects the importer
from the extension: PNG/JPG/JPEG/TGA/BMP/EXR, FBX/OBJ/GLB/GLTF, or WAV/MP3/OGG. `file` must be an
absolute path accessible on Studio's computer. Optional `assetName` names a model; images and audio
ignore it. The result includes `asset.assetid`.

```json
{ "file": "C:/assets/tree.glb", "assetName": "Tree" }
```

The tool permits up to five minutes for import and saves the level on success. The dev shared-file
adapter maps the unified import's paths just as it mapped image imports. The MCP server accepts
saved calls to `studiorpc_asset_manager_image_import` as a compatibility alias, while advertising
only the unified tool. No separate model import tool is registered.

If saving fails after import succeeds, the result preserves the imported asset and reports
`saved: false` and `saveError`, with the tool marked as failed. Inspect Studio and save the level;
do not repeat the import. A timeout or cancellation also requires inspection before retrying.

## Game defaults and PIE clients

`studiorpc_game_settings_read` takes no arguments and reads Workspace and StarterPlayer defaults.
`studiorpc_game_settings_update` takes a non-empty partial patch, preserves omitted values, and
saves the level after a successful update.

```json
{ "maxPlayers": 12, "gravity": 980, "walkSpeed": 500, "httpEnabled": false }
```

Supported fields are `maxPlayers` (integer 1–20), `gravity`, `gravityScale`, `jumpHeight`, `jumpPower`,
`useJumpPower`, `walkSpeed`, `maxSlopeAngle` (0–89 degrees), and `httpEnabled`. Movement values are
finite, non-negative numbers representable as a native float. Distances use centimeters, speed
uses cm/s, and gravity uses cm/s². These defaults configure subsequent play sessions; they do not
change existing live PIE characters. A save failure preserves the successful update's result and
reports that persistence failed; retry the save rather than the update.

`studiorpc_game_play` accepts `numberOfPlayer` from 1 to 8 when starting PIE. This limit is
separate from the world's `maxPlayers` setting and does not prove deployed server capacity.

`studiorpc_game_play` accepts `{ "addClient": true }` to queue one additional client in the running
PIE session without restarting it. Do not combine this with `numberOfPlayer` or `restart: true`.
Use `studiorpc_game_pie_status` to wait for the new client and retrieve its ID. Do not repeat an
accepted addition request.

`studiorpc_game_observe` accepts `pieSessionId` and `clientId` together to observe a particular
client. Omitting both selects the main client. At least one section must be requested:

```json
{ "character": true, "instances": true, "pieSessionId": "session-id", "clientId": "client-id" }
```

For player-specific tests, check the current local player for each client after every play or restart.
`targeted` identifies the default client, not a player index. For UI input, use a named target when
possible; it resolves the live rectangle. When testing a specific point, observe that client's current
UI rectangle and viewport after play, restart, or resize, and derive normalized coordinates from that
observation instead of reusing coordinates from a previous layout.

## Geometry drafts and placed models

`studiorpc_proceduralmodel_run` runs a draft recipe without placing a model. The world must already
be saved. `id` names `.overdare/geometry/<id>/main.py` under Studio's world directory; pass `code`
to write and run inline Python, or omit it to reuse the saved recipe. IDs contain at most 64
letters, digits, dots, underscores, or hyphens and cannot start with a dot. Empty inline code is
rejected instead of silently reusing an older recipe. `parameters` supplies the draft's parameter
object, and `timeoutSeconds` is 5–240, with a native default of 240. Only `action: "draft"` is
supported. Draft calls are serialized to keep saved recipe sources from racing.

`studiorpc_proceduralmodel_set` authors a placed model and supports both `rebuild` and `bake`.
Its RPC deadline is 30 seconds. Studio may continue the native run after this deadline, so inspect
the model before retrying a timed-out operation. The draft tool allows 300 seconds, beyond its
native 240-second deadline. A native `success: false` result is preserved
and marked as a tool error, including MCP `isError`, so a failed run is not presented as success.
For RPC errors, the draft tool includes Studio's error data in its error message, including traceback
and captured stdout/stderr when Studio provides them. Availability depends on the Studio version.

The standalone `game.ui.*`, `asset_manager.model.import`, and `instance.vfx_recipe.add` tools
are not exposed by this provider.
