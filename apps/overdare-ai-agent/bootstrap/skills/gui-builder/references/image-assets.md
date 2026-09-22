# GUI Artwork

Use this workflow when a GUI design needs generated artwork. Preserve an established native UI when that fits the requested design; new GUI roots do not automatically require generated assets. For artwork-backed builds, produce usable assets and bind them in Studio. A guide establishes the design but does not replace the requested assets. Honor existing-assets-only, no-generation, and preview-only requests.

This workflow applies equally to `ScreenGui`, `BillboardGui`, and `SurfaceGui`, including their icons and image-backed gauges. Rendering in the world does not remove image generation or reference-image support. Reuse suitable user-supplied icons, project images, and verified imported assets across roots; treat a style reference as guidance unless it is also suitable production artwork.

Track the guide, asset generation/import, GUI binding, and verification separately. When resuming, reconcile progress with actual files and imported asset IDs.

## Establish the guide

For screen-space gameplay HUDs, read the mobile-layout guidance in [studio-ui.md](studio-ui.md) first. Map actions to touch inputs, reserve active system-control space, and decide whether to retain or replace jump. Select typography from [fonts.md](fonts.md) only when choosing new faces.

Use the actual scene and user art direction for the game's mood. Open and attach the bundled [default mobile controls reference](default-mobile-controls.png) when generating a mobile HUD guide, alongside relevant scene/style images. Resolve its absolute path from the skill base directory: `references/default-mobile-controls.png`. It supplies control-placement context when gameplay captures omit CoreGui; do not copy its character or scenery. Retained system controls are layout context, not assets to regenerate or import.

Check that every reference is readable on the agent host before calling `generate_image`. In Mac-to-Windows dev, a Studio screenshot's `C:/...` path is not a Mac path: use the configured shared roots to locate and verify its local counterpart. Do not prepend the working directory to a foreign-host path or discard a required reference to bypass an error. Accept up to five PNG, JPEG, or WebP references per call.

Reuse an approved design or suitable current screenshot as the guide. When the visual direction or layout needs establishing, generate a guide with `background: "opaque"` for the requested GUI type:

- **ScreenGui:** Use a flat design at the target viewport/orientation, defaulting to mobile landscape. Keep the backdrop subdued and show required touch controls and gesture space. A manual-fire shooter needs a fire button; include planned custom jump or retained default-control space.
- **BillboardGui:** Use the nameplate, marker, or badge aspect ratio and a scene reference showing its target. Design for its apparent size at the intended viewing distance.
- **SurfaceGui:** Use the target face/panel aspect ratio and a scene reference showing placement. Keep the production design front-facing; scene perspective is context, not distortion to bake into the asset.

Do not force world GUI into a full-screen landscape guide or attach the default mobile-controls image unless a screen HUD is also being designed. Generated lettering indicates hierarchy; final labels use native text.

Inspect the guide for missing requested elements, readability, and overlaps before deriving assets. Reuse an existing guide if it already fits. Generate alternatives only when requested or needed to resolve a concrete design issue. For a requested mockup or preview, deliver the guide; for a build, continue to artwork production without an extra approval step. Reviewing an existing design does not require generating a guide.

## Produce the assets, not just the guide

Once the guide fits the request, list the actual visual pieces: button shells, icons/action glyphs, nameplate or sign backplates, gauge track/fill images, and any needed illustration. A noninteractive marker needs only its relevant pieces, not invented buttons. For each piece, keep its role, intended GUI target, and either a verified existing asset ID or a generation request. Track generated files and their import results with that list.

Generate the missing artwork identified by the chosen design. When it calls for illustrated buttons or panels, copying the guide's colors into `TextButton` and `Frame` does not supply those assets. Plain text, live fills, hit targets, and simple layout primitives stay native. Missing gameplay/controller code does not remove requested artwork from the deliverable; report unconnected behavior separately.

- Generate a shared button shell once and reuse it behind distinct glyphs. Separate frame and glyph images when matching geometry matters; a glyph request should not include another button frame.
- Attach the guide's actual `file` and, when useful, a finished anchor asset in each related `referenceImages` call. Repeating its description is not attachment. Keep references stable instead of chaining variant after variant.
- Request one isolated production asset per call, or use `grid` for a batch of matching isolated assets. Identify what changes and what stays, material, proportions, padding, alpha regions, and exclusions such as no labels. Borrow style without inheriting the guide's background, system controls, or neighboring panels.
- Once shared references exist, issue independent asset calls together. Keep Studio mutations in the single editing session. Match results by role rather than completion order and preserve successful outputs.

### Batch matching assets with a grid

`generate_image` accepts optional `model: "gpt-image-2.5-flare"` for fast everyday generation; omitting it keeps `gpt-image-2.5-sunburst` for editing precision. Both use the selected ChatGPT OAuth provider. Model selection does not switch accounts or providers.

For an asset sheet, pass `grid: { rows, columns, items }`. Supply exactly `rows * columns` item descriptions in row-major order (left to right, then top to bottom), with `null` for each intentional empty cell. Use up to 64 cells. Put common style, perspective, and exclusions in `prompt`; attach the guide using `referenceImages` as usual. Grid requests default to `background: "transparent"`, but pass it explicitly when alpha is required.

```json
{
  "prompt": "Front-facing 2D wall decorations. Warm brown outlines, pastel colors, shallow shading. Objects only, no room, characters, labels, or readable text. Window scenery stays inside each window frame.",
  "background": "transparent",
  "grid": {
    "rows": 3,
    "columns": 4,
    "items": [
      "Small frying pan hanging from a wooden ring",
      "Hanging pair of chopsticks",
      "Round wooden window with fogged glass",
      "Small framed picture of strawberry cake",
      "Framed folded neighborhood map",
      "Square wooden window overlooking green trees and a village",
      "Round window overlooking a blue sea",
      "Drink chalkboard with a cup illustration and decorative lines only",
      "Friendship frame containing a coral pink heart",
      "Framed gold regular-customer medal and ribbon",
      null,
      null
    ]
  }
}
```

The tool adds equal-cell layout, isolation, padding, and no-label instructions, generates one sheet, and crops it locally without another model call. `file` is the unchanged original sheet. `grid.cells` contains occupied cell PNG paths, item descriptions, one-based indices/rows/columns, zero-based pixel origins, dimensions, alpha statistics, and any pixel warnings. Previews contain the sheet first, then the returned cells in row-major order. Intentional blanks and fully transparent crops are omitted from files and previews; their diagnostics remain in `grid.skippedCells`. Original indices are preserved even when intermediate cells are skipped. The example returns one sheet plus 10 asset PNGs when all requested artwork is present.

Inspect occupied crops before import: pixel slicing cannot prove that generation followed the requested layout or item semantics. A cell marked `requestedEmpty` is an instruction, not proof of empty pixels; check its transparency status and warnings in `skippedCells`. A fully transparent occupied cell contains no artwork to recover. Preserve successful crops and regenerate only the missing asset using the guide or a successful matching asset as a style reference. For a defective non-empty crop, edit that crop instead. PNG crops preserve the original pixels and padding without resizing or trimming; uneven source dimensions can make adjacent crops differ by one pixel. If extraction fails, the result reports an error and preserves the sheet path for recovery. Do not regenerate merely to retry local cropping.

Visible artwork in a requested blank cell makes the sheet's layout incorrect even though that crop is omitted. If the sheet itself is a requested deliverable, use its file as an edit reference with the same grid and request removal of only the unwanted artwork, preserving occupied cells and layout. Keep successful crops until the repaired sheet is verified and stay within the sheet's remaining retry budget. If only individual assets are needed, report the sheet mismatch and use verified crops without repairing the whole batch solely for an unused cell.

## Import, bind, and verify

Import each reusable asset once using `studiorpc_asset_manager_image_import` with its returned absolute `file`; retain `asset.assetid`. For grid results, use each selected `grid.cells[].file`; the top-level `file` is the whole sheet. Follow [studio-ui.md](studio-ui.md) for hierarchy and image sizing.

`ImageButton` and `ImageLabel` are native GUI instances. Bind the generated shell/backplate/glyph IDs to their `Image` properties; keep text, live values, and input behavior separate. For `ProgressBar`, bind track/fill artwork to `TrackImage`/`FillImage` and update `Value` independently; see [gui-types.md](gui-types.md). A native hit target can contain image and text children. Do not flatten the entire guide behind invisible buttons or replace all artwork with plain Frames merely because the GUI must remain editable.

Before marking artwork complete, reconcile the required asset list with generated or reused files, imported IDs, and target bindings. A guide alone or an import step recorded as "attempted" does not complete a requested artwork-backed build. Report per-piece reuse or fallback explicitly. Verify images, proportions, and text in the actual rendering context. Test touch behavior for interactive GUI and distance/angle/occlusion for world GUI; a static marker does not require a button interaction.

## Retry and fallback

For each requested guide or asset, allow the initial call plus two retries/repairs: three attempts total. Count execution errors and unusable results against the same budget; a new prompt or edit call does not reset it. A successful guide does not count as an attempt to generate its button assets.

A grid generation or sheet repair counts as one attempt for the sheet and each occupied asset generated in that call. Keep successful assets and use the remaining budget for missing or defective deliverables. Correctly empty intentional blanks need no retries. Local cropping does not call the model or consume a generation attempt.

Retry only when a corrected input, a transient failure, or a targeted repair gives the next attempt a reason to succeed. Do not repeat unchanged authentication, permission, or unsupported-capability failures. Three attempts is a ceiling, not a requirement to exhaust. For a visual defect, edit the affected output as described below.

When the budget is exhausted or generation cannot proceed, explain the limitation and continue with suitable existing assets or native Studio panels/text/controls if that still serves the requested GUI. Preserve successful artwork and identify any fallback. If generated artwork is an explicit required deliverable, leave that part unfinished and report the missing access or capability rather than presenting a native substitute as complete. This fallback does not authorize code-drawn raster/SVG files, stock art, or another provider. Cancellation, rejection, or an explicit no-retry/no-fallback request takes precedence. An unavailable tool consumes no attempts; do not invent failed calls or retry until access changes.

### Transparent output

Pass `background: "transparent"` to `generate_image` for alpha assets and their repairs. Without an explicit setting, ordinary calls default to `auto` and grid calls default to `transparent`; prompt wording does not change the API option. Specify the alpha regions separately from material: an opaque button face with transparent exterior, a hollow frame with transparent exterior and opening, or a deliberately translucent face. Avoid an ambiguous "dark transparent center." Keep the full silhouette inside padding and constrain glow/shadows. Request actual PNG alpha, not a checkerboard depiction; the guide itself need not be transparent.

Inspect each asset. A viewer may display its own checkerboard behind real transparency. The tool's `transparency` reports actual original-pixel counts when available; also inspect a composited preview for placement and edge quality. PNG format or an alpha channel alone is not proof. Keep `requestedBackground`, backend `background` (possibly absent), and actual transparent pixels distinct: even an explicit request can return opaque artwork. An `opaque` or `empty` warning is an unusable attempt, not an instruction to discard the saved repair reference. If inspection is unavailable, report uncertainty rather than declaring success or failure from the background alone.

Use the remaining retries to repair an otherwise usable asset. Attach its file as the edit target and request removal of only the baked background, preserving the object, geometry, colors, edge detail, dimensions, and padding. Specify whether the interior stays opaque or also becomes transparent. Inspect the correction before importing; retain the original and use the best preserved source for a further correction. Repairs consume the same two-retry budget, then use the fallback above.

An `empty` result has no visible object to preserve. Use the guide or the last non-empty source for another generation attempt within the same budget, rather than asking to remove the background from an empty image.
