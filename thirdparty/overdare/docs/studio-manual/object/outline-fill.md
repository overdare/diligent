# Outline/Fill

## Overview

Outline and Fill can be used to highlight avatars or objects when they are distant or occluded by other objects.



## Type

<table><thead><tr><th width="123.33331298828125">Object</th><th>Description</th></tr></thead><tbody><tr><td>Outline</td><td>Displays an outline around a BasePart. The thickness can be adjusted via the Thickness property. It is useful for emphasizing distant objects, though the outline may be occluded by other objects.</td></tr><tr><td>Fill</td><td>Fills a BasePart with color, conforming to its shape.<br>The DepthMode property determines whether the Fill object is always visible, visible only when not occluded, or visible only when occluded, making it ideal for providing hints when objects are occluded by other objects.</td></tr></tbody></table>



## Outline

The Outline object in OVERDARE is used to emphasize the contours of specific objects, proving valuable for highlighting interactive elements or key targets in various scenarios.

For a Model containing multiple BaseParts or a Nutty (avatar model) composed of a Model, creating an Outline on the Model will apply it uniformly to all BaseParts within the Model.

<div data-full-width="false"><figure><img src="../../../.gitbook/assets/image (160).png" alt=""><figcaption></figcaption></figure></div>



### Outline Properties

<table><thead><tr><th width="145.3333740234375">Property</th><th>Description</th></tr></thead><tbody><tr><td>Enabled</td><td>Specifies whether the Outline effect is enabled or not.</td></tr><tr><td>Archivable</td><td>Determines whether the Outline can be replicated.</td></tr><tr><td>Adornee</td><td>Specifies the target object to apply the Outline effect.</td></tr><tr><td>Parent</td><td>Specifies the Outline’s position in the LevelBrowser hierarchy. The parent object serves as the default target for the Outline effect, but if Adornee is set, the Outline applies to the object set as Adornee regardless of this Parent property.</td></tr><tr><td>Name</td><td>Specifies the name of the Outline object.</td></tr><tr><td>Color</td><td>Specifies the color of the Outline.</td></tr><tr><td>Tickness</td><td><p>Specifies the thickness of the Outline.</p><ul><li>Default: 0.2</li><li>Range: 0.0 to 1.0</li></ul></td></tr></tbody></table>



### Script Feature

```lua
local outline = Instance.new("Outline")
outline.Parent = workspace.TargetPart
outline.Color = Color3.new(1, 0, 0) -- Red
outline.Tickness = 0.5
outline.Enabled = true
```



## Fill

The Fill object provides functionality to fill an object with a specific color and effect. It is useful for depicting character states, providing interaction feedback, or highlighting objects.

For a Model containing multiple BaseParts or a Nutty (avatar model) composed of a Model, creating a Fill on the Model will apply it uniformly to all BaseParts within the Model.

<figure><img src="../../../.gitbook/assets/image (161).png" alt=""><figcaption></figcaption></figure>



### Fill Properties

<table><thead><tr><th width="142">Property</th><th>Description</th></tr></thead><tbody><tr><td>Enabled</td><td>Specifies whether the Fill effect is enabled or not.</td></tr><tr><td>Archivable</td><td>Determines whether the Outline can be replicated.</td></tr><tr><td>Adornee</td><td>Specifies the target object to apply the Fill effect.</td></tr><tr><td>Parent</td><td>Specifies the Fill’s position in the LevelBrowser hierarchy. The parent object serves as the default target for the Fill effect, but if Adornee is set, the Fill applies to the object set as Adornee regardless of this Parent property.</td></tr><tr><td>Name</td><td>Specifies the name of the Fill object.</td></tr><tr><td>Color</td><td>Specifies the color of the Fill.</td></tr><tr><td>Transparency</td><td><p>Specifies the transparency of the Fill.</p><ul><li>Range: 0.0 to 1.0</li></ul></td></tr><tr><td>DepthMode</td><td><p>Determines the Fill’s display behavior depending on whether the object is occluded, with the following options:</p><ul><li>AlwaysOnTop: The Fill is always displayed, regardless of object occlusion.</li><li>VisibleWhenNotOccluded: The Fill is displayed only when the object is not occluded.</li><li>VisibleWhenOccluded: The Fill is displayed only when the object is occluded by other objects</li></ul></td></tr></tbody></table>



### DepthMode Detailed Descriptions

The **DepthMode** property of the Fill object determines its display behavior based on whether the object is occluded by other objects.



*   **AlwaysOnTop**

    Displays the Fill in the foreground of the screen, regardless of whether the object is occluded by other objects.

    <figure><img src="../../../.gitbook/assets/PicPic_2025-07-29 15 33 30.gif" alt=""><figcaption></figcaption></figure>


*   **VisibleWhenNotOccluded**

    Displays the Fill only when the object is not occluded by other objects but is directly visible.    \
    In other words, the Fill appears only when the object is clearly within the line of sight.

    <figure><img src="../../../.gitbook/assets/PicPic_2025-07-29 15 33 42.gif" alt=""><figcaption></figcaption></figure>


*   **VisibleWhenOccluded**

    Displays the Fill only when the object is occluded by other objects.    \
    The Fill does not appear when the object is directly visible, but is highlighted only when the object is occluded.

    <figure><img src="../../../.gitbook/assets/PicPic_2025-07-29 15 33 57.gif" alt=""><figcaption></figcaption></figure>



### Script Feature

```lua
local fill = Instance.new("Fill")
fill.Parent = workspace.TargetPart
fill.Color = Color3.new(0, 1, 0) -- Green
fill.Transparency = 0.4
fill.DepthMode = Enum.FillDepthMode.VisibleWhenOccluded
fill.Enabled = true
```
