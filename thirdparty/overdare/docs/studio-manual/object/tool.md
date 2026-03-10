# Tool

## Overview <a href="#overview" id="overview"></a>

A `Tool` is an `Instance` designed to be equipped and used directly by a character. It allows characters to wield weapons or equipment, use items like potions, and interact with the game world. `Tool` interacts with the character through the process of equipping and unequipping, playing a crucial role in various gameplay scenarios.

## How Tools Work <a href="#how-tools-work" id="how-tools-work"></a>

* A `Tool` interacts directly with the character model to implement equipping and unequipping.
* Tools are equipped in the character’s **right hand**, requiring the creation of a **Handle** Part.
* While it is possible to create a Tool without a `Handle`, it can only be equipped via scripting.
* The `Handle` serves as the reference point for positioning MeshParts and other Parts within the Tool.

## Tool Properties <a href="#tool-properties" id="tool-properties"></a>

Below are the key properties and their descriptions:

| Property                 | Description                                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TextureId**            | Specifies the image of the Tool displayed in the Backpack GUI.                                                                                                                                                              |
| **CanBeDropped**         | Determines whether the `Tool` is automatically dropped in front of the player when the `Tool`'s parent is changed to Workspace.                                                                                             |
| **Enabled**              | Determines whether the player can use the Tool. If set to false, methods and events related to Tool activation/deactivation are blocked, preventing the player from using the Tool.                                         |
| **Grip**                 | Sets the grip position when the character equips the `Tool` (using CFrame).                                                                                                                                                 |
| **GripForward**          | Represents the direction the grip is facing, corresponding to the values of R02, R12, and R22 of the Grip CFrame rotation matrix. Stored as a Cframe in the Tool.Grip property along with GripUp, GripRight, and GripPos.   |
| **GripPos**              | Determines the grip position relative to the Handle.                                                                                                                                                                        |
| **GripRight**            | Represents the lateral direction of the grip, corresponding to the R00, R10, and R20 values of the Grip CFrame rotation matrix. Stored as a Cframe in the Tool.Grip property along with GripUp, GripForward, and GripPos.   |
| **GripUp**               | Represents the upward direction of the grip, corresponding to the R01, R11, and R21 values of the Grip CFrame rotation matrix. Stored as a Cframe in the Tool.Grip property along with GripRight, GripForward, and GripPos. |
| **ManualActivationOnly** | Determines whether the Tool.Activated event is only triggered when Tool:Activate() is explicitly called in a script.                                                                                                        |

## How to Use Tools <a href="#how-to-use-tools" id="how-to-use-tools"></a>

### 1. Creating a Tool Instance <a href="#creating-a-tool-instance" id="creating-a-tool-instance"></a>

1.  Create a `Tool` instance in the **Level Browser (Workspace)**.

    <div align="left"><figure><img src="../../../.gitbook/assets/Group 1 (1).png" alt=""><figcaption></figcaption></figure></div>
2.  Create a `Part` under `Tool` and rename it to `Handle`.

    <div align="left"><figure><img src="../../../.gitbook/assets/Group 2 (2).png" alt=""><figcaption></figcaption></figure></div>

    <div align="left"><figure><img src="../../../.gitbook/assets/Group 3 (1).png" alt=""><figcaption></figcaption></figure></div>
3.  Place the `MeshPart` or `Part` as the tool to be held under the `Handle` and adjust its `CFrame` relative to the handle to set the correct equipping position.

    <figure><img src="../../../.gitbook/assets/tool-1.png" alt=""><figcaption></figcaption></figure>

    <figure><img src="../../../.gitbook/assets/tool-2.jpg" alt=""><figcaption></figcaption></figure>

### 2. Testing Tool Equipment <a href="#testing-tool-equipment" id="testing-tool-equipment"></a>

1. Run the game and control the character.
2. Make the character **touch** the `Tool` placed in the `Workspace`.
3. When the `Handle` is touched, the character will equip the corresponding `Tool` in their right hand.
   *   If the Tool is not equipped correctly, adjust the position and orientation of the `MeshPart` or `Part` under the `Handle`.

       <figure><img src="../../../.gitbook/assets/Group 6.png" alt=""><figcaption></figcaption></figure>

       <figure><img src="../../../.gitbook/assets/Group 7.png" alt=""><figcaption></figcaption></figure>

## Equipping and Unequipping Tools via Script <a href="#equipping-and-unequipping-tools-via-script" id="equipping-and-unequipping-tools-via-script"></a>

### When Scripting is Required <a href="#when-scripting-is-required" id="when-scripting-is-required"></a>

In some cases, you may want the `Tool` to be equipped only when a specific trigger or condition is met. In such cases, you can programmatically equip or unequip the `Tool` using scripts.

### Methods for Equipping Tools <a href="#methods-for-equipping-tools" id="methods-for-equipping-tools"></a>

You can equip a `Tool` to a character in two ways shown below using scripts:

1. Calling the **Humanoid:EquipTool** Method
   * The following method allows the character to equip the `Tool` directly.
   * Example Code:

```lua
local function Equip(player)
     local character = player.Character
     local humanoid = character:FindFirstChild("Humanoid")
     local myTool = game.Workspace:FindFirstChild("MyTool")

     if humanoid and myTool then
         humanoid:EquipTool(myTool)
     end
end
```

2. Changing the **Tool.Parent**

* You can make characters equip a `Tool` by directly changing its parent object.
* Example Code:

```lua
local function Equip(player)
     local myTool = game.Workspace:FindFirstChild("MyTool")
     local character = player.Character

     if character and myTool then
         myTool.Parent = Character
     end
end
```

### Unequipping Tools <a href="#unequipping-tools" id="unequipping-tools"></a>

There are two main ways to unequip a `Tool`:

1. **Default Unequip**: The `Tool` is unequipped and placed back in the player’s `Backpack`.
2. **Destroy**: You can delete the `Tool` instance if it is no longer needed.
   * Example Code:

```lua
     local myTool = game.Workspace:FindFirstChild("MyTool")
     if myTool then
         myTool:Destroy()
     end
```

3. **Drop**: If CanBeDropped is true, you can drop the Tool in front of the player by setting its parent to Workspace.
   * Example Code:

```lua
     local myTool = game.Workspace:FindFirstChild("MyTool")
     if myTool then
         myTool.Parent = game.Workspace
     end
```

## Using Events for Tool Interactions <a href="#using-events-for-tool-interactions" id="using-events-for-tool-interactions"></a>

A `Tool` has various **events** that are triggered when equipped. These can be used to implement additional **visual effects (VFX)** or actions when the character equips a specific `Tool`.

1.  **Create a ParticleEmitter**: Add a `ParticleEmitter` to the `Handle` or any designated part where the effect should appear.

    <figure><img src="https://stackedit.io/.gitbook/assets/Group%208%20(1).png" alt=""><figcaption></figcaption></figure>
2. **Edit ParticleEmitter Properties** : Adjust size, direction, count, and other particle settings.
3. **Disable ParticleEmitter** : Set `ParticleEmitter` Enabled to false so the effect doesn’t appear before equipping.
4. **Write a Script**: Write a script to activate the `ParticleEmitter` only when the weapon is equipped.

```lua
local Tool = script.Parent
local Emitter = Tool.Handle.LightSaber.ParticleEmitter
Tool.Equipped:Connect(function()   
     if Emitter then
         Emitter.Enabled = true
     end
 end)
 
 Tool.Unequipped:Connect(function()   
     if Emitter then
         Emitter.Enabled = false
     end
 end)
```

{% embed url="https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FhRPi87oM9ttlk5nyu7L7%2Fuploads%2Fhxyq40FEzff4Dt6vmed4%2F2025-02-17%2021-57-57.mp4?alt=media&token=84dba803-dd83-4e5a-a322-f09d3715f46d" %}
