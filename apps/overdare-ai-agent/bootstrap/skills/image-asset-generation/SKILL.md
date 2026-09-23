---
name: image-asset-generation
description: Generate or revise standalone game image assets, including cohesive icon sets and sprite sheets, with OVERDARE's generate_image tool. Use when the deliverable is image files rather than a Studio GUI build.
---

# Standalone Image Assets

Use this skill when the requested deliverable is artwork itself. For building or editing a Studio GUI that uses artwork, use `gui-builder` instead.

## Generate the requested assets

- For matching isolated assets that can share cell proportions, pass a structured `grid: { rows, columns, items }` to `generate_image`. Put common style and exclusions in `prompt`, and describe each item in row-major order. Prompt wording such as "4 by 3 grid" does not replace the `grid` argument. The tool returns one original sheet plus lossless PNG crops for occupied cells.
- Pass `background: "transparent"` when cutout assets need alpha. Choose `gpt-image-2.5-flare` for new artwork or batches and `gpt-image-2.5-sunburst` for a targeted edit that must preserve an existing image; honor a model named by the user. Attach an actual file through `referenceImages` when editing or using an image as a style reference.
- Keep the requested output format in view: the top-level `file` is the sheet, while `grid.cells[].file` contains individual assets. Deliver the requested form rather than treating the preview as the only artifact.

## Verify before deciding to regenerate

Check the requested count and subjects, obvious clipping or cell overlap, transparency, and appearance at the intended display size. Grid alpha statistics and warnings describe pixels; they do not establish whether each pictured item is correct or whether a faint mark matters in use.

Keep a usable first result when the only concern is tiny detached specks or faint edge pixels that are not visible at the intended size. Do not redraw an entire sheet merely to make a microscopic preview cleaner. If a pristine file is required and local image processing is available, clean only verified stray pixels in a copy of the generated PNG, keep the original, and compare the result. Preserve legitimate separated details such as sprinkles, steam, or sparkles; do not apply an unverified global alpha cutoff.

Use another `generate_image` call when a requested item is missing or wrong, transparency is unusable, clipping or overlap materially affects the asset, or the user asks for a visual revision. Repair an affected asset when the individual crops are the deliverable; repair the sheet when its layout is itself the deliverable. Retain successful assets and choose the best verified version rather than assuming a later generation is better.
