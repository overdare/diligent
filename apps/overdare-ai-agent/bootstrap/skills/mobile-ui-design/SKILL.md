---
name: mobile-ui-design
description: Design OVERDARE mobile screen-space UI with visual mockups, reference-guided image assets, and touch-ready Studio layouts. Use for HUDs, menus, action icons, panels, visual restyling, and UI mockup images. Also handle small existing-UI edits directly. Not for 3D world decoration or gameplay-only changes.
---

# Mobile UI Design

Design from the user's visual goal, not from an official UI template. A mockup is a design reference, not a working screen. Repeated text prompts alone do not ensure consistent images; attach the actual reference files when generating related assets.

## Choose the needed depth

- **Mockup only:** generate and show the requested design image. Do not import assets or change Studio unless asked.
- **New or substantially restyled UI:** generate a game-specific UI guide image first, use it as the visual reference for reusable art, then build and verify the real UI.
- **Small existing-UI edit:** read the target and its owner, make the focused change, and verify it. Skip mockup generation and asset searches unless the edit needs new art.

Use existing screenshots, images, and assets supplied by the user. Inspect the current screen and controller before changing an existing UI. Ask only for missing choices that materially affect the result, such as a different screen purpose or orientation; do not run a template-selection questionnaire.

## Generate a guide for this game

Ground the guide in the current game's mood and visual language: its existing scene/UI screenshots when available, the user's art direction, genre, palette, materials, and requested screen purpose. Use the context already available; do not choose a generic genre preset or introduce a template-selection questionnaire. Mockup-only work does not require a Studio connection.

Generate one project-specific guide with `generate_image` before producing its individual UI assets. Use landscape mobile orientation unless the user specifies otherwise. Make GUI placement, hierarchy, touch targets, typography, and the requested elements clearly readable; keep any scene backdrop subdued so it supports the game's atmosphere without hiding the layout. Request a flat screen design, not a phone photograph or presentation board.

Pass relevant user images or saved game screenshots in `referenceImages`, explaining whether each supplies visual style or layout context. Inspect the returned preview (or use `read_image`) and retain its exact `file` as the guide for downstream generation. Actually attach that file in subsequent `referenceImages`; repeating its written description is not a substitute. Treat requested dimensions as design intent, not proof of the saved image dimensions.

If this task already has a guide matching the current game's UI direction, reuse it. Generate a new guide when that direction changes substantially, not for each icon or minor existing-UI edit. Do not stop for an extra approval round unless the user requested a design review or a genuinely blocking choice remains.

Keep the top-left system menu, bottom-left joystick, and bottom-right jump region clear in gameplay HUD concepts. Intentional full-screen menus and modals need a different layout from in-game controls. Do not generate unused screens or several alternatives unless the request warrants them.

Reserved regions constrain placement, not control names: a requested custom Jump button can sit above or inward from the native jump region. Do not assume the user wants to replace a system control merely because both have the same action.

If `generate_image` is unavailable for the selected provider, explain that limitation. Do not claim to have generated a mockup, switch providers, or substitute code-drawn or stock art without approval. Native GUI edits that do not need generated art can still proceed within the request.

## Generate a coherent asset set efficiently

Translate the chosen design into a small asset list before generating: shared button/frame art, distinct glyphs, reusable panel backgrounds, and any illustration that really belongs in the screen. Keep live labels, numbers, health fills, and touch behavior as native UI, not baked into artwork.

- Create a common frame once and reuse the same imported asset behind different glyphs when exact geometry matters. Do not regenerate the frame independently for every button.
- Distinguish identical frames across the new controls from pixel-identical copying of a supplied mockup. The former needs one shared frame asset. The latter needs source artwork or an available extraction method; generative editing must not be presented as lossless extraction.
- Use the mockup and, when useful, one finished anchor asset in `referenceImages` for all related requests. Ask to preserve the relevant material, lighting, edge treatment, and proportions while changing the requested content. Specify which attached image controls layout versus asset styling.
- Keep a stable reference set. Do not chain each new variant from the previous variant and accumulate style drift. Reference-guided generation improves consistency but does not guarantee identical pixels.
- After shared references exist, submit independent `generate_image` calls together in the same tool batch. One call produces one image. Do not mix generation with Studio mutation calls in that batch, or spawn a separate editing agent for every icon.
- Each request must be self-contained: the intended asset, the shared reference paths, what changes, what stays, transparency, padding, and any exclusion such as no labels. A glyph layer should have a transparent background and no duplicate button frame.
- Keep outputs associated with their requested roles, not completion order. Reuse successful outputs; on a failed request, report it and do not restart the whole set or silently substitute a different method.

Use real local paths from user attachments, `generate_image.file`, or saved screenshots. Reading an image or naming it in a prompt is not the same as attaching it: pass the paths explicitly in `referenceImages` for each dependent call. The current tool accepts up to five PNG, JPEG, or WebP references.

For a mockup-only request, finish here with the image and any unverified design constraints. Otherwise continue with the implementation the user requested; do not stop at an unconnected picture of a UI.

## Build and verify the actual screen

Read [references/studio-ui.md](references/studio-ui.md) when creating, importing, or wiring Studio GUI instances. Reuse the existing screen owner. Import each reusable image once through `studiorpc_asset_manager_image_import`, then use its returned `asset.assetid` for the appropriate `ImageLabel` or `ImageButton`.

Image generation is independent work; Studio imports, hierarchy edits, and script changes still belong to one editing session. Create parents before children, batch siblings where supported, and do not run competing Studio writers. A mockup must not become a full-screen bitmap with invisible buttons pretending to be implemented UI.

Read back important properties and inspect a play-test screenshot. Check touch-target separation, safe areas, text contrast and overflow, icon proportions, shared frame consistency, and visual feedback. Validate changed scripts and exercise requested interactions. If Studio or play-test access is unavailable, state what was produced and what remains unverified.

Report the mockup or reference used, generated/imported assets, actual UI changes, and verification. Distinguish a design preview from a functioning screen.
