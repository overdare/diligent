# Studio UI Implementation

Use the available Studio tool schemas and `overdaresearch` for unfamiliar APIs; do not infer unsupported properties from Roblox. OVERDARE does not have `UICorner`, `UIGradient`, or `ViewportFrame`.

## Ownership and tools

- Browse the relevant `StarterGui` subtree with `studiorpc_level_browse` and read target GUIDs with `studiorpc_instance_read`. Preserve unrelated screens and the existing controller's responsibilities.
- Build static UI with `studiorpc_instance_upsert`, not a script that recreates the entire screen at runtime. Reuse or create a `ScreenGui`, then containers, then sibling controls. Use returned parent GUIDs; do not mix adds and updates in one call.
- Move existing instances with `studiorpc_instance_move` instead of deleting and recreating them. Delete only an explicitly replaced target or your own temporary objects.
- For a local image not yet imported, pass its verified absolute path to `studiorpc_asset_manager_image_import` and use the returned `asset.assetid`. Import each reusable image once. In cross-host dev setups, let the existing import bridge map the path.
- Bind verified image asset IDs to Image properties, not local file paths. Reuse the same frame asset across sibling buttons, with separate glyph images where appropriate. A resizing panel/frame should use `ScaleType = "Slice"` and a `SliceCenter` measured in source-image pixels when its artwork supports nine-slicing.

## Mobile layout

Start with touch-only play, not a desktop HUD scaled down. Identify the game's required actions and map each to an existing system control, a custom button, or a touch gesture. Separate these inputs from information displays such as HP, ammo, score, and the crosshair.

For a manual-fire FPS/TPS, include a clearly visible fire button, movement control, and a usable camera/aim drag region. Include reload, weapon switching, and jump when those actions exist; include ADS, crouch, grenades, or other abilities only when supported or requested. Preserve an established auto-fire design instead of inventing manual fire. A gun icon, ammo counter, or reticle alone is not a firing input.

Use reachable thumb zones and plan simultaneous movement, aiming, and firing. Keep a camera-drag region clear of panels that capture touch; size and separate hit targets for fingers, not a mouse pointer. Distinguish a tap action from a held action such as automatic fire, including release/cancel behavior. Do not rely on hover, right-click, keyboard shortcuts, or tiny text links.

Plan against the actual mobile viewport, including system controls, before generating a HUD guide or placing panels. An empty `StarterGui` does not mean the screen is empty: runtime CoreGui still supplies movement, jump, and system-menu controls.

For a new or rearranged mobile gameplay HUD, open the bundled [default mobile controls reference](default-mobile-controls.png) with `read_image`. Resolve its path from this skill's base directory: `references/default-mobile-controls.png`. This viewport-focused edit of the supplied screenshot shows the top-left system controls, lower-left movement input, and lower-right default jump without the phone frame or editor chrome. Gameplay screenshots and UI observations can omit these controls; their absence in a capture does not establish that they are disabled.

Combine this reference with the supplied/current gameplay screenshot and available runtime observations. Verified current control state and bounds take precedence over the baseline. For other screenshots, distinguish the playable viewport from any phone bezel or editor chrome; the baseline's character, ground, and sky are not an art direction. Map control touch/drag space, safe edges, and existing HUD using viewport-relative positions rather than copying screenshot pixels. A small joystick thumb at rest does not show its full movement area.

Choose how the requested HUD coexists with these controls:

- **Retain:** Keep the system menu and joystick accessible. Place health, weapon/ammo panels, and action buttons outside active controls and their gesture space. Keep aim/camera interaction space and the gameplay center usable. Prefer this when the layout remains readable and reachable.
- **Replace jump:** For a new or fully redesigned gameplay HUD, if retaining the default jump crowds the right-side combat controls or obscures required information, integrate a custom jump into the action group using [custom-jump.md](custom-jump.md). This can be a layout decision within the requested HUD build; the user need not name the API or separately ask to hide the default. Explain the choice briefly, preserve jump behavior, and connect the replacement before hiding the default.
- **Keep scope:** Honor a request to retain default controls. A font, color, or small spacing edit does not authorize replacing jump. Move the affected custom UI instead; do not disable the joystick or unrelated CoreGui to make room.

Carry this retain/replace decision and occupied regions into the guide prompt. A design reference without default controls is incomplete layout evidence, not proof that its corners are available. If the runtime viewport cannot be inspected, use available screenshots conservatively and leave actual fit explicitly unverified.

- Position groups primarily with Scale and AnchorPoint; use Offset for padding and concrete touch-target sizes. Preserve icon aspect ratios.
- Use legible text with strong backing contrast. Important mobile labels usually need at least 24px at the reference viewport. Prefer short English text unless the user requests localization; use image glyphs instead of emoji.
- When selecting or changing font faces, read [fonts.md](fonts.md). Keep text live in `TextLabel` / `TextButton`; validate wrapping and glyphs at the actual viewport.
- Keep normal HUDs in ZIndex 0–99, intentional overlays/modals in 100–199, and debug layers in 200+. Runtime overlap checks compare the same band; do not move ordinary buttons into overlay bands to hide warnings.
- Use `DisplayOrder` to order screen roots and ZIndex for elements within them. Handle overflow and tool warnings rather than clipping away a layout error.

## Behavior and evidence

Read the existing owning script before adding another. Touch events and local UI belong in a `LocalScript`; game-rule validation belongs on the server. Scripts must use `studiorpc_script_read`, `_add`, `_edit`, or `_delete`, never filesystem editing of Luau sources.

At runtime, `StarterGui` is copied to each player's `PlayerGui`; bind the runtime controls there. Use `Activated` for tap actions. For held actions, use the project's input controller and supported touch start/end/cancel APIs, ensuring release or interrupted input stops the action. Keep live values and text native so they can update independently of art.

Connect buttons to existing gameplay actions rather than only changing colors or printing a preview message. If the required combat/controller API is missing, identify the missing integration and report the affected controls as unconnected; do not invent a combat system or claim the HUD is playable from appearance alone.

For visual-only edits, read back the changed properties and inspect the affected screen. For a new or rearranged gameplay HUD, verify the mapped touch actions with active system UI and no keyboard or mouse-only shortcuts. For shooters this includes movement, aiming, firing, and the applicable reload/weapon/jump controls. Test hold/release and concurrent touches where supported; sequential injected clicks alone do not establish multi-touch usability. Check that fingers and controls do not obscure critical health or ammo information. For interaction or script changes, run `validatelua` on changed scripts and play-test the affected behavior. A successful import or an empty `Play.log` alone does not verify an interaction. Save the level and report any remaining checks.
