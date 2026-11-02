# GUI Types and World GUI

Choose the root by where the GUI lives: `ScreenGui` for the viewport, `BillboardGui` for camera-facing world markers such as nameplates and health bars, and `SurfaceGui` for signs and panels on a Part face. Preserve an existing root type, and edit an existing world GUI in place rather than replacing it with a screen HUD.

## World GUI in OVERDARE

- **SurfaceGui:** The API overview repeats camera-facing wording, but it renders on the Part face chosen by `Face`. Order GUIs on one face with `ZOffset`, not `DisplayOrder`. Its Size is derived from the Part, so size children relative to the surface.
- **BillboardGui:** Offsets differ from Roblox. `PositionOffset` is camera-relative in centimeters, `PositionOffsetWorldSpace` is relative to the target, `ExtentsOffsetWorldSpace` is relative to the target's bounds, and `SizeOffset` is in the screen plane. `DistanceLowerLimit` and `DistanceUpperLimit` bound the visible range.
- Leave `AlwaysOnTop` off unless the marker should show through walls.
- Assign `Adornee` as an instance in Editor Luau (`gui.Adornee = part`). If the live schema does not expose it, keep the existing binding or set it from the owning client script rather than inventing a GUID or string encoding.
- A `LocalScript` parented under a world Part does not run; run client presentation logic from a valid client location.
- Character and object labels are usually spawned by a controller. Keep that lifecycle, and read the controller when a change must survive respawn or track live state.
- Screen-layout observations do not include world GUI. Check it in the world viewport or a play-test, at the distances and angles players see it from.

## Related classes

- **ProgressBar:** OVERDARE's native gauge. `Value` (0–1) drives a linear or radial fill; keep `TrackImage` and `FillImage` artwork separate from labels and frames. Use the asset ID format the property accepts, confirmed by readback, rather than rewriting prefixes by analogy.
- **ProximityPrompt:** handles press and hold interaction near an object, but it is not an image container; place custom artwork in a GUI root. `ClickablePrompt` is a Studio testing convenience, not mobile input.
- **CoreGui:** native system UI; see [core-gui.md](core-gui.md).
