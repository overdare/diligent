# GUI Artwork

For a new GUI or full visual redesign, produce usable artwork and bind it in Studio. A guide image establishes the design; it is not the button/frame asset and does not finish the image work. Follow an explicit request for existing assets only, no generation, or a preview before implementation.

Track the guide, asset generation/import, GUI binding, and verification separately. When resuming, reconcile progress with actual files and imported asset IDs.

## Establish the guide

For gameplay HUDs, read the mobile-layout guidance in [studio-ui.md](studio-ui.md) first. Map actions to touch inputs, reserve active system-control space, and decide whether to retain or replace jump. Select typography from [fonts.md](fonts.md) only when choosing new faces.

Use the actual scene and user art direction for the game's mood. Open and attach the bundled [default mobile controls reference](default-mobile-controls.png) when generating a mobile HUD guide, alongside relevant scene/style images. Resolve its absolute path from the skill base directory: `references/default-mobile-controls.png`. It supplies control-placement context when gameplay captures omit CoreGui; do not copy its character or scenery. Retained system controls are layout context, not assets to regenerate or import.

Check that every reference is readable on the agent host before calling `generate_image`. In Mac-to-Windows dev, a Studio screenshot's `C:/...` path is not a Mac path: use the configured shared roots to locate and verify its local counterpart. Do not prepend the working directory to a foreign-host path or discard a required reference to bypass an error. Accept up to five PNG, JPEG, or WebP references per call.

Generate one flat screen design with `background: "opaque"` using the target viewport/orientation, defaulting to mobile landscape. Keep the backdrop subdued; show the required touch controls and gesture space as well as status displays. A manual-fire shooter guide needs a visible fire button, not just ammo and a reticle. Include the planned custom jump or retained default-control space. Generated lettering indicates hierarchy; final labels use native text.

Inspect the guide for missing controls and overlaps before deriving assets. Reuse an existing guide if it already fits. Generate alternatives only when requested or needed to resolve a concrete design issue. For a requested mockup or preview, deliver the guide; for a build, continue to artwork production without an extra approval step. Reviewing an existing design does not require generating a guide.

## Produce the assets, not just the guide

Once the guide fits the request, list the actual visual pieces: button shells, action glyphs, panel backplates, and any needed illustration. For each piece, keep its role, intended GUI target, and either a verified existing asset ID or a generation request. Track generated files and their import results with that list.

Generate the missing artwork next. In a new HUD with no suitable existing art, buttons and styled panels need their own image requests; copying the guide's colors into `TextButton` and `Frame` is not this workflow. Plain text, live fills, hit targets, and simple layout primitives stay native. Missing gameplay/controller code does not remove the need for button artwork; report unconnected behavior separately.

- Generate a shared button shell once and reuse it behind distinct glyphs. Separate frame and glyph images when matching geometry matters; a glyph request should not include another button frame.
- Attach the guide's actual `file` and, when useful, a finished anchor asset in each related `referenceImages` call. Repeating its description is not attachment. Keep references stable instead of chaining variant after variant.
- Request one isolated production asset per call: identify what changes and what stays, its material, proportions, padding, alpha regions, and exclusions such as no labels. Borrow style without inheriting the guide's background, system controls, or neighboring panels.
- Use `n` only when several variants of that same prompt are needed; different asset roles still need separate prompts. Read the ordered `images` array and compare its length with `requestedCount`. If the server returns fewer images than requested, preserve those files and report the shortfall; do not automatically issue more calls to fill the count.
- Once shared references exist, issue independent asset calls together. Keep Studio mutations in the single editing session. Match results by role rather than completion order and preserve successful outputs.

## Import, bind, and verify

Import each reusable output once using `studiorpc_asset_manager_image_import` with its returned absolute `images[i].file`; retain `asset.assetid`. Follow [studio-ui.md](studio-ui.md) for hierarchy and image sizing.

`ImageButton` and `ImageLabel` are native GUI instances. Bind the generated shell/backplate/glyph IDs to their `Image` properties; keep text, live values, and input behavior separate. A native hit target can contain image and text children. Do not flatten the entire guide behind invisible buttons or replace all artwork with plain Frames merely because the GUI must remain editable.

Before marking artwork complete, reconcile the asset list with generated files, imported IDs, and target bindings. A guide alone, zero button-art requests with no existing art, or an import step recorded as "attempted" is incomplete. Report per-piece reuse or fallback explicitly. Verify the actual screen's images, proportions, text readability, and touch behavior.

## Retry and fallback

For each requested guide or asset, allow the initial call plus two retries/repairs: three attempts total. Count execution errors and unusable results against the same budget; a new prompt or edit call does not reset it. A successful guide does not count as an attempt to generate its button assets.

Retry only when a corrected input, a transient failure, or a targeted repair gives the next attempt a reason to succeed. Do not repeat unchanged authentication, permission, or unsupported-capability failures. Three attempts is a ceiling, not a requirement to exhaust. For a visual defect, edit the affected output as described below.

When the budget is exhausted or generation cannot proceed, explain the limitation and continue with suitable existing assets or native Studio panels/text/controls if that still serves the requested GUI. Preserve successful artwork and identify any fallback. If generated artwork is an explicit required deliverable, leave that part unfinished and report the missing access or capability rather than presenting a native substitute as complete. This fallback does not authorize code-drawn raster/SVG files, stock art, or another provider. Cancellation, rejection, or an explicit no-retry/no-fallback request takes precedence. An unavailable tool consumes no attempts; do not invent failed calls or retry until access changes.

### Transparent output

Pass `background: "transparent"` to `generate_image` for alpha assets and their repairs; saying it only in the prompt leaves the API setting at auto. Specify the alpha regions separately from material: an opaque button face with transparent exterior, a hollow frame with transparent exterior and opening, or a deliberately translucent face. Avoid an ambiguous "dark transparent center." Keep the full silhouette inside padding and constrain glow/shadows. Request actual PNG alpha, not a checkerboard depiction; the guide itself need not be transparent.

Inspect each asset. A viewer may display its own checkerboard behind real transparency. The tool's per-image `transparency` reports actual original-pixel counts when available; also inspect a composited preview for placement and edge quality. PNG format or an alpha channel alone is not proof. Keep `requestedBackground`, backend `background` (possibly absent), and actual transparent pixels distinct: even an explicit request can return opaque artwork. An `opaque` or `empty` warning is an unusable attempt, not an instruction to discard the saved repair reference. If inspection is unavailable, report uncertainty rather than declaring success or failure from the background alone.

Use the remaining retries to repair an otherwise usable asset. Attach its file as the edit target and request removal of only the baked background, preserving the object, geometry, colors, edge detail, dimensions, and padding. Specify whether the interior stays opaque or also becomes transparent. Inspect the correction before importing; retain the original and use the best preserved source for a further correction. Repairs consume the same two-retry budget, then use the fallback above.

An `empty` result has no visible object to preserve. Use the guide or the last non-empty source for another generation attempt within the same budget, rather than asking to remove the background from an empty image.
