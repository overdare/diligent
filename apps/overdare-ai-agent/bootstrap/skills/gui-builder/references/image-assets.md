# GUI Artwork

Use this workflow for a new GUI, a full visual redesign, or new artwork within an existing GUI. Reuse suitable existing assets and guides as inputs to the design; generate only the missing artwork. Follow an explicit user request to use existing assets or native controls without generation.

## Establish the visual direction

For gameplay HUDs, first apply the mobile-layout guidance in [studio-ui.md](studio-ui.md): map required actions to touch inputs, identify active system controls, and decide whether default jump stays or gets a working replacement. Pass the actual gameplay screenshot as layout context when available, separately identifying any style reference. Specify occupied touch regions and required visible action buttons in the prompt, separately from status displays. Show retained controls as layout context, or include the planned custom jump in the action group.

When generating a mobile HUD guide, include the bundled [default mobile controls reference](default-mobile-controls.png) in `referenceImages` alongside the game/style references. Resolve `references/default-mobile-controls.png` against the skill's base directory and pass that absolute path. Label it as system-control layout context, particularly when the gameplay capture omits CoreGui. State any verified differences or planned jump replacement. Do not copy its character or scenery into the design. It is for the guide's layout, not a style reference to attach to every isolated icon request or an asset to import into Studio.

Request a complete touch-play layout: a manual-fire shooter guide must show the fire button and the other planned controls, plus usable movement and aiming space. A reference showing only health, ammo, and a reticle supplies visual style but is missing mobile input controls. Check the generated guide against the action list before producing assets; correct missing controls as well as overlaps.

For a new visual direction, generate one game-specific guide with `generate_image` before producing individual assets. Ground it in the user's art direction, existing scene/UI screenshots, palette, materials, genre, and screen purpose. Reuse a supplied or previously generated guide when it already fits; do not generate another guide for every icon or minor revision.

Choose supported text roles from [fonts.md](fonts.md) when the screen needs new typography. Include the selected families and hierarchy in the guide prompt as visual intent; assign the actual native fonts during implementation rather than reproducing generated lettering.

Request a flat screen design with readable placement, hierarchy, and touch targets, not a phone photograph or presentation board. Use the target viewport and orientation; default to mobile landscape when unspecified. Keep the backdrop subdued. Respect the system-control bounds described in [studio-ui.md](studio-ui.md) for gameplay HUDs, and distinguish them from intentional full-screen menus or modals.

Pass relevant user images or saved screenshots in `referenceImages`, identifying each one's role: layout, style, or asset detail. Inspect the returned preview (or use `read_image`) against the occupied regions and retain the exact returned `file`. Correct conflicting placements before using the guide for downstream assets. Retained system controls shown in the guide are context, not assets to regenerate or duplicate. Requested dimensions are design intent; inspect the saved image before relying on its pixel dimensions.

Generate only the screens and assets needed for the request. Continue into implementation without an extra approval round unless the user requested a review or a blocking choice remains. If the user requests a design preview first, deliver that preview and wait for their feedback before building the GUI.

## Generate reusable assets

Translate the design into the assets the screen needs: shared frames, distinct glyphs, panel backgrounds, and illustrations. Keep labels, numbers, health fills, and touch behavior native.

- Generate a common frame once and reuse its imported asset behind distinct glyphs when exact geometry matters. A glyph layer needs a transparent background without a duplicate frame.
- Attach the actual guide file and, when useful, one finished anchor asset in `referenceImages` for each related request. Repeating a prompt or reading an image does not attach it. Keep the reference set stable rather than chaining each variant from the previous one.
- Make each request self-contained: intended asset, reference roles, what changes, what stays, material, lighting, proportions, transparency, padding, and exclusions such as no labels. Describe an isolated production asset rather than another HUD mockup; borrow style from the guide without inheriting its backdrop or surrounding controls.
- Once shared references exist, issue independent `generate_image` calls together in the same tool batch. One call produces one image. Keep Studio mutations out of that batch and in the single editing session.
- Associate outputs with their requested roles, not completion order. Reuse successful outputs instead of restarting the entire set after one failure.

Use real local paths from attachments, saved screenshots, or `generate_image.file`. The tool accepts up to five PNG, JPEG, or WebP references. Reference-guided generation improves consistency, but pixel-identical reuse requires the same source asset; do not present generative editing as lossless extraction.

If `generate_image` is unavailable for the selected provider or returns an execution error, report the limitation. Do not silently switch providers or replace requested generated art with code-drawn or stock art. A successfully returned image with a visual defect follows the repair flow below. Continue native GUI work that does not depend on the missing artwork when it remains within the request.

## Transparent assets: specify, inspect, repair

Specify which regions need alpha separately from the object's material. A solid button/backplate can have an opaque dark face with transparency only outside its silhouette. A hollow frame needs transparency in its opening too; request a translucent center only when the design needs it. Avoid ambiguous phrases such as "dark charcoal transparent center." Keep the full silhouette inside clear margins, constrain glow/shadows, and request real PNG alpha rather than a drawn checkerboard or colored background. A guide image itself does not need transparent pixels.

For example: "One isolated circular button, opaque face and rim, genuine alpha outside the silhouette, clear padding, no surrounding scene or checkerboard." For a hollow frame, explicitly replace the face requirement with "the interior opening is also fully transparent."

Inspect each returned asset separately. A viewer may display its own checkerboard behind real transparency; do not discard an image from that appearance alone. Use available read-only image inspection to check actual alpha pixels in the required regions, or inspect a composited preview. PNG format or an alpha channel alone does not prove that any pixels are transparent. If no suitable check is available, state the uncertainty instead of declaring transparency verified or failed.

If the asset is otherwise usable but has a baked background, attempt one targeted repair before abandoning it:

1. Keep the original file and successful sibling assets. Pass the affected file as the edit target in `generate_image.referenceImages`; the prompt must identify it as the image to edit, not just a style reference.
2. Request background removal while preserving the object's shape, colors, material, edge detail, dimensions, and padding. Specify exterior/interior alpha independently. For example: "Edit the attached asset. Remove only the baked checkerboard outside the button; output genuine alpha there. Preserve the opaque face, rim, colors, and geometry. Do not redraw the design or render another checkerboard."
3. Inspect the corrected output for actual transparency and damaged edges before importing it. Use its returned file if it passes. This is one additional generation/edit call per defective asset, not a restart of the whole set.

If that repair also fails, retain both files, explain the remaining defect, and ask before further paid attempts or a change of visual approach. Do not silently replace generated artwork with plain native panels/buttons. Unaffected GUI work can continue; report the affected artwork as unfinished. Honor any user instruction not to retry.

## Import and integrate

Follow [studio-ui.md](studio-ui.md) for import, instance construction, and image sizing, using each generated image's returned absolute `file`. Build native controls and text, not a full-screen guide bitmap with invisible buttons. Check shared frame consistency, icon proportions, transparency, and contrast in the actual screen. Include generated/imported assets in the result; a guide image alone does not complete a GUI implementation request.
