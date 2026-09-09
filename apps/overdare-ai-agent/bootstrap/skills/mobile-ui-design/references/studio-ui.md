# Studio UI Implementation

Use the available Studio tool schemas and `overdaresearch` for unfamiliar APIs; do not infer unsupported properties from Roblox. OVERDARE does not have `UICorner`, `UIGradient`, or `ViewportFrame`.

## Ownership and tools

- Browse the relevant `StarterGui` subtree with `studiorpc_level_browse` and read target GUIDs with `studiorpc_instance_read`. Preserve unrelated screens and the existing controller's responsibilities.
- Build static UI with `studiorpc_instance_upsert`, not a script that recreates the entire screen at runtime. Reuse or create a `ScreenGui`, then containers, then sibling controls. Use returned parent GUIDs; do not mix adds and updates in one call.
- Move existing instances with `studiorpc_instance_move` instead of deleting and recreating them. Delete only an explicitly replaced target or your own temporary objects.
- Import a generated image's returned absolute `file` using `studiorpc_asset_manager_image_import`. Bind the returned `asset.assetid` directly; never invent an asset ID or pass an agent-host path as an Image property. In cross-host dev setups, let the existing import bridge map the path.
- Reuse the same frame image asset across sibling buttons, with separate glyph images where appropriate. A resizing panel/frame should use `ScaleType = "Slice"` and a `SliceCenter` measured in source-image pixels when its artwork supports nine-slicing. Do not guess slice coordinates from requested generation dimensions.

## Mobile layout

Use the actual screen or viewport when available. The existing mobile-landscape reference is approximately `1386 x 640`, not a fixed resolution requirement. Keep the play view open in gameplay HUDs.

- Position groups primarily with Scale and AnchorPoint; use Offset for padding and concrete touch-target sizes. Preserve icon aspect ratios.
- Keep custom gameplay controls away from the system menu (top-left), joystick (bottom-left), and jump button (bottom-right). Inspect their current bounds when possible rather than hardcoding a template's reserved rectangle.
- Use legible text with strong backing contrast. Important mobile labels usually need at least 24px at the reference viewport. Prefer short English text unless the user requests localization; use image glyphs instead of emoji.
- Keep normal HUDs in ZIndex 0–99, intentional overlays/modals in 100–199, and debug layers in 200+. Runtime overlap checks compare the same band; do not move ordinary buttons into overlay bands to hide warnings.
- Use `DisplayOrder` to order screen roots and ZIndex for elements within them. Handle overflow and tool warnings rather than clipping away a layout error.

## Behavior and evidence

Read the existing owning script before adding another. Touch events and local UI belong in a `LocalScript`; game-rule validation belongs on the server. Scripts must use `studiorpc_script_read`, `_add`, `_edit`, or `_delete`, never filesystem editing of Luau sources.

At runtime, `StarterGui` is copied to each player's `PlayerGui`; bind the runtime controls there and use `Activated` for touch buttons. Keep live values and text native so they can update independently of art. Add only behavior requested by the user.

Run `validatelua` on changed scripts. Play-test requested interactions and inspect `studiorpc_game_screenshot` for layout and visual consistency. An attractive mockup, a successful import, or an empty `Play.log` alone does not prove the screen works. Save the level and clearly report any remaining visual or behavioral uncertainty.
