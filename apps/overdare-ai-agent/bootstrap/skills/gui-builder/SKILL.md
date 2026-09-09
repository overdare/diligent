---
name: gui-builder
description: Build and restyle OVERDARE screen-space GUI with game-specific guide images, reusable artwork, and supported Studio fonts. Use for HUDs, menus, action buttons, panels, and typography changes that need actual GUI implementation. Not for 3D world decoration or gameplay-only changes.
---

# GUI Builder

Build functioning GUI in Studio from the user's visual goal: generate a guide image that fits the game, use it to produce coherent reusable artwork, then construct and verify the screen. Do not start from an official UI template. Repeated text prompts alone do not ensure consistent images; attach the actual reference files when generating related assets.

Use existing screenshots, images, and assets supplied by the user. Inspect the current screen and controller before changing an existing UI. Ask only for missing choices that materially affect the result, such as a different screen purpose or orientation; do not run a template-selection questionnaire.

For a small edit to existing GUI that needs no new art, read the target and its owner, make the focused change, and verify it without regenerating images.

## Choose typography that Studio can render

Read [references/fonts.md](references/fonts.md) when choosing or changing fonts. For a new screen, choose supported family/weight/style combinations for the text roles before generating the guide image. Match the game's mood while keeping body text and controls readable; preserve existing typography when the request does not change it.

Include the selected families and text hierarchy in the guide prompt as design intent, not a promise of exact generated font rendering. Keep labels, counters, and localized copy as native text. Apply their actual `FontFace` values in Studio rather than baking text into image assets to imitate a font.

## Generate a guide for this game

Ground the guide in the current game's mood and visual language: its existing scene/UI screenshots when available, the user's art direction, genre, palette, materials, and requested screen purpose. Use the context already available; do not choose a generic genre preset or introduce a template-selection questionnaire.

Generate one project-specific guide with `generate_image` before producing its individual UI assets. Use landscape mobile orientation unless the user specifies otherwise. Make GUI placement, hierarchy, touch targets, typography, and the requested elements clearly readable; keep any scene backdrop subdued so it supports the game's atmosphere without hiding the layout. Request a flat screen design, not a phone photograph or presentation board.

Pass relevant user images or saved game screenshots in `referenceImages`, explaining whether each supplies visual style or layout context. Inspect the returned preview (or use `read_image`) and retain its exact `file` as the guide for downstream generation. Actually attach that file in subsequent `referenceImages`; repeating its written description is not a substitute. Treat requested dimensions as design intent, not proof of the saved image dimensions.

If this task already has a guide matching the current game's UI direction, reuse it. Generate a new guide when that direction changes substantially, not for each icon or minor existing-UI edit. Do not stop for an extra approval round unless the user requested a design review or a genuinely blocking choice remains.

Keep the top-left system menu, bottom-left joystick, and bottom-right jump region clear in gameplay HUD concepts. Intentional full-screen menus and modals need a different layout from in-game controls. Do not generate unused screens or several alternatives unless the request warrants them.

Reserved regions constrain placement, not control names: a requested custom Jump button can sit above or inward from the native jump region. Do not assume the user wants to replace a system control merely because both have the same action.

If `generate_image` is unavailable for the selected provider, explain that limitation. Do not claim to have generated a guide image, switch providers, or substitute code-drawn or stock art without approval. Native GUI edits that do not need generated art can still proceed within the request.

## Generate a coherent asset set efficiently

Translate the chosen design into a small asset list before generating: shared button/frame art, distinct glyphs, reusable panel backgrounds, and any illustration that really belongs in the screen. Keep live labels, numbers, health fills, and touch behavior as native UI, not baked into artwork.

- Create a common frame once and reuse the same imported asset behind different glyphs when exact geometry matters. Do not regenerate the frame independently for every button.
- Distinguish identical frames across the new controls from pixel-identical copying of a supplied image. The former needs one shared frame asset. The latter needs source artwork or an available extraction method; generative editing must not be presented as lossless extraction.
- Use the guide image and, when useful, one finished anchor asset in `referenceImages` for all related requests. Ask to preserve the relevant material, lighting, edge treatment, and proportions while changing the requested content. Specify which attached image controls layout versus asset styling.
- Keep a stable reference set. Do not chain each new variant from the previous variant and accumulate style drift. Reference-guided generation improves consistency but does not guarantee identical pixels.
- After shared references exist, submit independent `generate_image` calls together in the same tool batch. One call produces one image. Do not mix generation with Studio mutation calls in that batch, or spawn a separate editing agent for every icon.
- Each request must be self-contained: the intended asset, the shared reference paths, what changes, what stays, transparency, padding, and any exclusion such as no labels. A glyph layer should have a transparent background and no duplicate button frame.
- Keep outputs associated with their requested roles, not completion order. Reuse successful outputs; on a failed request, report it and do not restart the whole set or silently substitute a different method.

Use real local paths from user attachments, `generate_image.file`, or saved screenshots. Reading an image or naming it in a prompt is not the same as attaching it: pass the paths explicitly in `referenceImages` for each dependent call. The current tool accepts up to five PNG, JPEG, or WebP references.

## Build and verify the actual screen

Read [references/studio-ui.md](references/studio-ui.md) when creating, importing, or wiring Studio GUI instances. Reuse the existing screen owner. Import each reusable image once through `studiorpc_asset_manager_image_import`, then use its returned `asset.assetid` for the appropriate `ImageLabel` or `ImageButton`.

Assign each native text role its complete `FontFace` (Family, Weight, Style) from the typography plan. Read it back and check the actual rendering for glyph coverage, line wrapping, clipping, and readability; the guide image cannot verify those properties.

Image generation is independent work; Studio imports, hierarchy edits, and script changes still belong to one editing session. Create parents before children, batch siblings where supported, and do not run competing Studio writers. Build native controls and live labels; do not substitute a full-screen guide bitmap with invisible buttons for the actual GUI.

Read back important properties and inspect a play-test screenshot. Check touch-target separation, safe areas, text contrast and overflow, icon proportions, shared frame consistency, and visual feedback. Validate changed scripts and exercise requested interactions. If Studio or play-test access is unavailable, state what was produced and what remains unverified.

Report the guide image used, generated/imported assets, actual GUI changes, and verification. A guide image alone does not complete the GUI task.
