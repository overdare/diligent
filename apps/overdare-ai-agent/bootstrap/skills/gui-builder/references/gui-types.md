# GUI Types and World Placement

Use this reference when choosing a GUI root or working on world labels, signs, gauges, or proximity interaction UI. Image generation, user reference images, icons, fonts, and editable child elements apply across all three roots; follow [image-assets.md](image-assets.md) for artwork and [studio-ui.md](studio-ui.md) for tool use.

## Choose the rendering context

| Root | Use | Inspect before editing |
| --- | --- | --- |
| `ScreenGui` | Viewport HUD, menus, notifications | Screen owner, viewport, input regions, `DisplayOrder` |
| `BillboardGui` | Camera-facing world nameplates, health bars, lock/status markers | Existing world target, attachment, size, offsets, viewing distance |
| `SurfaceGui` | Signs, terminals, scoreboards on a Part face | Target Part, `Face`, proportions, approach angles |

World GUI is still GUI, even when decorative or noninteractive. Edit an existing billboard in place rather than rejecting it as 3D decoration or replacing it with a screen HUD. If multiple contexts are requested, share suitable artwork while retaining separate roots and controllers.

The official [GUI manual](https://docs.overdare.com/manual/studio-manual/gui) distinguishes these three roots. The [SurfaceGui API](https://docs.overdare.com/development/api-reference/classes/surfacegui) overview currently repeats camera-facing wording, but its `Face` property and the manual describe a Part surface. Use the surface model and verify it in Studio; camera-facing behavior belongs to `BillboardGui`.

## Attach and size world GUI

Inspect the existing parent and `Adornee` before changing placement. The [SurfaceGuiBase API](https://docs.overdare.com/development/api-reference/classes/surfaceguibase) documents a BasePart target and shared `Active`, `AlwaysOnTop`, `LightInfluence`, `Brightness`, `MaxDistance`, and clipping controls. Set these for the requested visibility and interaction rather than automatically drawing every marker through walls.

Use the live tool schema for instance-reference assignments. If `Adornee` is not exposed by the upsert schema, do not invent a GUID/string property encoding. Preserve an existing binding, use a supported BasePart parent when appropriate, or assign the reference through the owning client script with Studio script tools. Keep the static GUI editable. Client presentation control must run from a valid client execution location; do not assume a LocalScript parented under a world Part executes.

- **Billboard:** The [BillboardGui API](https://docs.overdare.com/development/api-reference/classes/billboardgui) provides `PositionOffset` in camera-relative centimeters, `PositionOffsetWorldSpace` relative to the target, `ExtentsOffsetWorldSpace` relative to target bounds, and `SizeOffset` in the screen plane. Use the required coordinate frame, not Roblox `StudsOffset`. Inspect `Size`, `DistanceLowerLimit`, and `DistanceUpperLimit` together. `CurrentDistance` is read-only.
- **Surface:** Select `Face` from the target Part's orientation and use `ZOffset` for ordering GUIs on the same face. Do not apply screen `DisplayOrder` or assume Roblox `CanvasSize`, `PixelsPerStud`, or `SizingMode`. The base API describes surface `Size` as derived/read-only even if a tool accepts a Size field; verify the rendered dimensions and size child elements relative to the surface.

Preserve the existing spawn/clone lifecycle for character or object labels. Read the responsible controller when changes must survive respawn or update live state. Do not add unrelated gameplay behavior to a visual change.

## Child elements and adjacent UI

The [GUI manual](https://docs.overdare.com/manual/studio-manual/gui) covers `Frame`, `ScrollingFrame`, `TextLabel`, `ImageLabel`, `TextButton`, `ImageButton`, `UIListLayout`, `UIGridLayout`, and `UIAspectRatioConstraint`. These are child content/layout choices, not alternatives to a rendering root. Prefer native scrolling and layout where appropriate, and preserve image proportions.

- [ProgressBar](https://docs.overdare.com/development/api-reference/classes/progressbar): Use native `Value` (0–1) for live fill, including linear and radial gauges. Reuse or generate `TrackImage` and `FillImage` separately from labels and decorative frames. Keep imported IDs in the format accepted by the target property; confirm with readback and rendering instead of rewriting asset-ID prefixes by analogy. Check empty, partial, and full values, and arc/start angle when using radial fill.
- [UIStroke](https://docs.overdare.com/development/api-reference/classes/uistroke): Add supported border or text outlines as children of the relevant GUI object. It is a modifier, not a root or a replacement for requested artwork.
- [ProximityPrompt](https://docs.overdare.com/development/api-reference/classes/proximityprompt): Covers nearby-object action UI with press/hold behavior. Preserve its interaction controller, distance, line-of-sight, and hold semantics. It is not a freeform image container: place custom artwork in an appropriate GUI root and integrate only through verified APIs. Do not assume Roblox custom-style properties. `ClickablePrompt` is documented as Studio testing convenience rather than mobile input support; test the actual mobile interaction.
- `StarterGui` and `PlayerGui` own authored/runtime player UI; `CoreGui` is native system UI. Read [core-gui.md](core-gui.md) for supported system controls. Base classes such as `GuiObject`, `GuiBase2d`, and `SurfaceGuiBase` describe inherited behavior, not additional concrete roots to instantiate.

Coverage checked against the official [documentation index](https://docs.overdare.com/llms.txt) and GUI manual on 2026-09-21. Do not infer support for `TextBox`, `ViewportFrame`, `VideoFrame`, `CanvasGroup`, `UICorner`, `UIGradient`, or other Roblox classes from generic prose or an absent search result. For an unlisted request, check current OVERDARE docs and tool schemas, then describe the specific capability gap if unresolved.

## Verify in context

Read back the edited root, target, and child properties. Inspect world GUI near and far, while rotating the camera and approaching different sides. Check attachment tracking, scale limits, clipping, occlusion, lighting contrast, and text/icon readability. For surface GUI, confirm the intended face and lack of baked perspective distortion. For interactive world GUI, exercise its buttons or hold action at usable distances and angles, including touch when supported; visibility alone does not prove input works.

A screen-layout observation that omits world GUI is not evidence that it is missing or unsupported. Use the world viewport/play-test and instance reads. Report any unavailable rendering or interaction checks explicitly.
