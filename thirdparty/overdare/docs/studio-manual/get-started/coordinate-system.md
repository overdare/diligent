# Coordinate System

Coordinate systems in OVERDARE Studio consist of a 3D coordinate system for representing the position, size, and rotation of objects in 3D space, and a 2D coordinate system (UDim2) for defining the scale and offset of GUI elements in 2D space.



## 3D Coordinate System <a href="#d-coordinate-system" id="d-coordinate-system"></a>

In OVERDARE Studio, the 3D coordinate system uses the right-handed coordinate system, and the default unit for position and size is **centimeters (cm)**.

<figure><img src="../../../.gitbook/assets/CoordinateSystem.png" alt=""><figcaption></figcaption></figure>



The **Position** or **Orientation** of an object can be set individually using **Vector3**, but using the **CFrame** data type allows you to set both at once.

```lua
-- Position
Part.Position = Vector3.new(0, 50, -300)

-- Orientation
Part.Orientation = Vector3.new(0, 0, 30)

-- CFrame
local targetPosition = Vector3.new(0, 30, 0)
local upVector = Vector3.new(0, 1, 0)
Part.CFrame = CFrame.lookAt(Part.Position, targetPosition, upVector)
```



CFrame, short for **Coordinate Frame**, is a data type that contains both the Position and Orientation information of an object.



Learn More

{% content-ref url="../../../development/api-reference/datatype/cframe.md" %}
[cframe.md](../../../development/api-reference/datatype/cframe.md)
{% endcontent-ref %}



## 2D Coordinate System <a href="#d-coordinate-system-1" id="d-coordinate-system-1"></a>

In OVERDARE Studio, the 2D space uses the UDim2 format. In UDim2, Scale represents a percentage (%) of the parent object’s size, and Offset represents the position or size in pixels.

<figure><img src="../../../.gitbook/assets/image (44).png" alt=""><figcaption></figcaption></figure>

```lua
local TextLabel = script.Parent

TextLabel.AnchorPoint = Vector2.new(0.5, 0.5)
TextLabel.Position = UDim2.new(0.5, 0, 0.5, 0)
TextLabel.Size = UDim2.new(0.5, 0, 0, 200)

local TextPos = TextLabel.Position
print(TextPos.X.Scale, TextPos.X.Offset, TextPos.Y.Scale, TextPos.Y.Offset)
```
