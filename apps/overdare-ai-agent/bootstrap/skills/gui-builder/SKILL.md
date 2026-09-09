---
name: gui-builder
description: Create and edit OVERDARE screen-space GUI in Studio, including HUDs, menus, controls, layout, and typography. Not for standalone artwork, 3D decoration, or gameplay-only changes.
---

# GUI Builder

Build the requested GUI in Studio, preserving the existing screen owner and unrelated work. Follow the user's explicit design choices over this skill's workflow defaults. Inspect the relevant screen and properties before editing; read its controller when changing behavior or investigating runtime overrides. Match the game's visual direction and reuse suitable existing assets.

## Read only what the task needs

- **Fonts:** Read [references/fonts.md](references/fonts.md) when selecting or changing a font family, weight, or style. Reusing a verified existing `FontFace` on a new screen does not require another catalog lookup.
- **New GUI or full visual redesign:** Read [references/image-assets.md](references/image-assets.md). Plan and execute guide → button/frame asset generation and import → GUI binding → verification as distinct stages. A guide alone does not satisfy artwork generation. This is the default even when the user does not explicitly mention images; also use it for new artwork in an existing GUI.
- **Studio implementation:** Read [references/studio-ui.md](references/studio-ui.md) for hierarchy, layout, image binding, or controller changes. For gameplay HUDs, map required actions to touch inputs, then resolve active system-control space and whether to retain or replace jump before generating the guide. A font-only property edit can use the assignment and verification instructions in the font reference.
- **Custom jump:** Read [references/custom-jump.md](references/custom-jump.md) when replacing the default jump button or wiring a custom button to character jumping.

Do not load all references up front. Focused text, font, color, spacing, or behavior edits to existing GUI need only their relevant references. Skip image generation for a new GUI when the user explicitly requests existing assets only, native controls only, or no generation. Being able to construct a screen from plain Frames and text is not a reason to bypass its visual design workflow.

## Implement the requested change

Native GUI means editable instances, not image-free styling: use `ImageButton`/`ImageLabel` for generated artwork and separate text, live fills, and input behavior. Do not skip button artwork because a `TextButton` is clickable or the game controller is not implemented yet.

Preserve typography for unrelated edits. Use project context for routine design choices, briefly state the direction, and implement it without a generic HUD/style questionnaire. Ask only about unresolved scope or behavior choices; retain answers already given.

Keep Studio writes in one editing session. Reuse existing parents and controllers, create parents before children, and batch sibling edits where supported. Add only the requested behavior.

Match verification to the change: read back edited properties and inspect the affected area at the actual viewport; exercise changed interactions and validate changed scripts. Broaden or repeat checks only after another change, a failure, or an unresolved concern.

Report the implemented result and relevant verification briefly. If blocked, identify the missing input or access and the unfinished part; if a skill instruction caused the stop, cite that specific instruction. Do not claim checks that Studio or play-test access did not allow.
