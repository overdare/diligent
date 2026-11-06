# Studio UI Implementation

## Building in Studio

- Build static UI with `studiorpc_execute_luau` (`target: "Editor"`), not with a script that recreates the GUI at runtime. Edit existing GUI in place, and leave controller-owned spawning, such as character labels, to its controller. For root and attachment choices, see [gui-types.md](gui-types.md).
- Setting `Parent` only changes the hierarchy; change `Position`/`Size` with Editor Luau.
- Import a local image once with `studiorpc_asset_manager_import` and bind the returned `asset.assetid`, never a file path. Reuse one frame asset across sibling buttons. A resizing panel should use `ScaleType = "Slice"` with a `SliceCenter` in source-image pixels. To show part of an image, set `ImageRectOffset` and `ImageRectSize` in source-image pixels instead of cropping the file.
- Use `ImageButton` for clickable artwork. `TextButton` is for text controls, not a substitute for planned button artwork.

## Mobile layout

This section covers screen HUDs and menus; world GUI does not need a screen HUD or a jump replacement.

Design for touch-only landscape play from the start, not a desktop HUD scaled down. Map each required action to a system control, a custom button, or a gesture; an icon, counter, or reticle alone is not an input. Distinguish tap actions from held ones, including release and cancel.

The screen is never empty. At runtime CoreGui supplies a top-left system menu, a lower-left joystick, and a lower-right jump button, even when `StarterGui` is empty, and screenshots can omit them. For a new or rearranged HUD, use the safe-area root from SKILL.md. For inventory or equipment, read [core-gui.md](core-gui.md) and [backpack.md](backpack.md) first: Backpack Tools already have a native selector at the bottom of the screen.

Decide how the HUD coexists with the default controls, and carry the decision and the occupied regions into the guide prompt:

- **Retain** (default): keep them accessible and place the HUD outside their touch areas.
- **Replace jump:** in a new or fully redesigned HUD, when the default jump crowds the action buttons, move jump into the action group with [custom-jump.md](custom-jump.md). Say so briefly, and connect the replacement before hiding the default.
- A font, color, or spacing edit never justifies replacing jump or disabling CoreGui.

Other layout rules:

- Position top-level groups with Scale and AnchorPoint, and use Offset for concrete touch-target sizes.
- Important mobile labels need at least 24px at 1600×720, the Studio mobile simulator's screen. Keep text live in `TextLabel`/`TextButton`; read [fonts.md](fonts.md) when choosing faces.
- Keep normal HUDs in ZIndex 0–99, overlays and modals in 100–199, and debug layers in 200+. Runtime overlap checks compare within a band, so do not move ordinary buttons into overlay bands to hide warnings. Order screen roots with `DisplayOrder`.

## Layout tools

Let Studio solve placement instead of computing each child's Position and Size; a solved layout keeps working when content, item count, or viewport changes. The list below is a starting point, not the full set: check the class catalog (`studiorpc_instance_schema_search({})`) for other UI layouts, constraints, and modifiers, then read the chosen classes' properties before using them. Pick the tool that matches the structure:

- `UIListLayout` for rows and columns of items. `HorizontalFlex`/`VerticalFlex` (Fill, SpaceBetween, SpaceAround, SpaceEvenly) distribute free space, `Wraps` flows items onto new lines, and `ItemLineAlignment` sets cross-axis placement. Add a `UIFlexItem` to a child that should grow, shrink, or align differently from its siblings.
- `UIGridLayout` for uniform cells such as inventory and shop slots; `FillDirectionMaxCells` caps cells per line.
- `UITableLayout` for aligned columns of differing widths, such as leaderboards and stat sheets. Each direct child is a row (or column) and its children are the cells.
- `UIPageLayout` for swipeable pages such as tutorials, shop tabs, or character select, with built-in animated transitions and `Next`/`Previous`/`JumpTo`.
- `AutomaticSize` fits a frame, label, or button to its content; `AutomaticCanvasSize` does the same for a `ScrollingFrame` canvas.
- `UIPadding` insets content. `UIAspectRatioConstraint` keeps icons and cards in proportion, `UISizeConstraint` clamps a size, `TextScaled` with `UITextSizeConstraint` fits text within a readable range, and `UIScale` scales a whole subtree without changing authored values.

## Visual finish

Native GUI should read as game UI, not default flat rectangles. Keep one treatment consistent across a screen and fit it to the concept.

- **Strokes:** White text with a black `UIStroke` is the default; vary it by concept. Frames and buttons also benefit from strokes or shadows.
- **Shape and depth:** Rounded or accented corners (`UICorner`) and subtle `UIGradient` fills keep panels and buttons from looking flat.
- **Motion:** Consider animation for state changes such as presses, panel open/close, and value changes, but keep it short and restrained. Tweening a `UIScale` animates a press or pop without fighting the layout. Run UI tweens in a `LocalScript`.

## Behavior

- Touch input and local UI belong in a `LocalScript`; game rules stay on the server. Read the existing controller before adding another.
- GUI authored in `StarterGui` runs as a copy in each player's `PlayerGui`; bind that copy. Use `Activated` for taps, and make sure release or interruption stops a held action.
- Connect buttons to existing gameplay actions. If the needed API is missing, report the affected controls as unconnected rather than inventing a system.
- Injected play-test clicks run one at a time, so they cannot show that simultaneous touches work; report that as unverified.
