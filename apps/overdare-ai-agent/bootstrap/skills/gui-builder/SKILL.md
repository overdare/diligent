---
name: gui-builder
description: Create, edit, or review OVERDARE GUI in Studio, including ScreenGui HUDs and menus, BillboardGui nameplates and markers, SurfaceGui signs and panels, gauges, and interaction prompts. Use shared image generation, reference images, icons, layout, and typography for screen and world GUI. Not for standalone artwork, non-GUI 3D decoration, or gameplay-only changes.
---

# GUI Builder

Build the requested GUI in Studio, preserving the existing GUI owner and unrelated work. Follow the user's design choices over this skill's workflow defaults. The layout rule below is not a workflow default: apply it to every screen GUI build, including requests to copy a mockup exactly ("make it the same", "follow this as is") and mockups supplied as a guide or grid sheet. Skip it only when the user explicitly turns it off, for example "do not apply layout rules" or "place everything at exactly these positions." Inspect the relevant GUI root, attachment target, and properties before editing; read its controller when changing behavior or investigating runtime overrides. Match the game's visual direction and reuse suitable existing assets.

For review-only requests, inspect the supplied GUI and relevant references, then report findings without generating images or editing Studio. For a requested mockup or preview, stop at that deliverable; continue through implementation when the user requested a build.

## Read only what the task needs

- **GUI type and scope:** Read [references/gui-types.md](references/gui-types.md) when selecting a root, working with world-space GUI, gauges, or proximity prompts. `ScreenGui`, `BillboardGui`, and `SurfaceGui` are all in scope; preserve an existing root type unless the requested behavior requires changing it.

- **Fonts:** Read [references/fonts.md](references/fonts.md) when selecting or changing a font family, weight, or style. Reusing a verified existing `FontFace` on a new screen does not require another catalog lookup.
- **Visual design and artwork:** Read [references/image-assets.md](references/image-assets.md) when making a mockup or when the requested design needs generated artwork, including new assets for an existing GUI. Use an existing approved design or establish a guide when needed, then generate missing assets, import and bind them, and verify the result. A guide alone does not satisfy a request for usable artwork.
- **Studio implementation:** Read [references/studio-ui.md](references/studio-ui.md) for hierarchy, layout, styling (strokes, gradients, corners, shadows, motion), image binding, or controller changes. For screen-space gameplay HUDs, map required actions to touch inputs, then resolve active system-control space and whether to retain or replace jump before generating the guide. A font-only property edit can use the assignment and verification instructions in the font reference.
- **Custom jump:** Read [references/custom-jump.md](references/custom-jump.md) when replacing the default jump button or wiring a custom button to character jumping.
- **Built-in GUI:** Read [references/core-gui.md](references/core-gui.md) when planning around native controls, checking default GUI support, or changing CoreGui visibility. For inventory, equipment selection, or a hotbar, also read [references/backpack.md](references/backpack.md) and check the native Tool inventory before building a replacement.

Do not load all references up front. Focused text, font, color, spacing, or behavior edits need only their relevant references.

Start a new screen or a broad redesign from a mockup ([references/image-assets.md](references/image-assets.md)); small edits do not need one. "Mockup" means any design image for the GUI: user-supplied or generated, a single screen or a grid sheet. image-assets.md calls it the guide.

Choose artwork when the requested visual direction needs it, even if the user does not name image generation. Honor existing-assets-only or no-generation requests, and do not replace requested artwork with plain controls.

## Implement the requested change

Native GUI means editable instances: bind artwork with `ImageButton`/`ImageLabel` or the image properties of `ProgressBar` and keep text, live fills, and input behavior separate.

Preserve typography for unrelated edits. Use project context for routine design choices, briefly state the direction, and implement it without a generic HUD/style questionnaire. Ask only about unresolved scope or behavior choices; retain answers already given.

Keep Studio writes in one editing session. Reuse existing parents and controllers, create parents before children, and batch sibling edits where supported. Add only the requested behavior.

Layout rule: a mockup sets look, content, and hierarchy, not screen coordinates, because a mockup shows one screen size and device screens vary. Anchor each group to the screen edge or corner it sits near with Scale and AnchorPoint, size touch targets with Offset, and let layout classes place the children.

For a new or rearranged screen HUD or menu, set the root's `ScreenInsets` to `CoreUISafeInsets` so its children follow the device safe area. Put full-screen backgrounds and modal dimmers in a separate root with `ScreenInsets = None`.

Match verification to the change: read back edited properties and inspect the affected area at the actual viewport and, for world GUI, relevant viewing distances and angles; exercise changed interactions and validate changed scripts. Broaden or repeat checks only after another change, a failure, or an unresolved concern.

Report the implemented result and relevant verification briefly. If blocked, identify the missing input or access and the unfinished part; if a skill instruction caused the stop, cite that specific instruction. Do not claim checks that Studio or play-test access did not allow.
