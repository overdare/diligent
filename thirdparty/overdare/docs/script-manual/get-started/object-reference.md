# Object Reference

## Overview <a href="#overview" id="overview"></a>

Depending on the type of object, such as Service, Part, or Player, you can get the required object in various ways.



## Getting the Service Object <a href="#getting-the-service-object" id="getting-the-service-object"></a>

A Service object refers to a built-in system object designed to perform specific functions within the game.

```lua
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerScriptService = game:GetService("ServerScriptService")
local ServerStorage = game:GetService("ServerStorage")
local StarterGui = game:GetService("StarterGui")
local StarterPlayer = game:GetService("StarterPlayer")
local Players = game:GetService("Players")
...
```



## Referencing Parent Object <a href="#referencing-parent-object" id="referencing-parent-object"></a>

```lua
-- Parent of an object
local ParentPart   = Part.Parent  

-- Parent of a script
local ScriptParent = script.Parent
```



## Referencing Child Object <a href="#referencing-child-object" id="referencing-child-object"></a>

```lua
-- Return object by address (may fail if object is not loaded yet)
local ChildPart1 = Workspace.ChildPart  

-- Return the first object matching the name
local ChildPart2 = Workspace:FindFirstChild("ChildPart")  

-- Wait for the object to be returned
local ChildPart3 = SomePart:WaitForChild("ChildPart")

```



## Getting All Child Objects <a href="#getting-all-child-objects" id="getting-all-child-objects"></a>

When the hierarchy of the Part is as follows:

<div align="left"><img src="../../../.gitbook/assets/image (35).png" alt=""></div>

```lua
local Part = Workspace:WaitForChild("Part")  

-- Return all the first child objects of the parent object (Part)
local Children = Part:GetChildren()  

for _, child in ipairs(Children) do
    -- Print ChildPart1, ChildPart2
    print(child.Name)
end  
  

-- Return all descendant objects of the parent object (Part)
local Descendants = Part:GetDescendants()  

for _, descendant in ipairs(Descendants) do
    -- Print ChildPart1, ChildPart1-1, ChildPart2, ChildPart2-1
    print(descendant.Name)
end
```



## Getting All Players <a href="#getting-all-players" id="getting-all-players"></a>

```lua
local Players = game:GetService("Players")
local PlayerList = Players:GetPlayers()

for i = 1, #PlayerList do
    print(PlayerList[i])
end
```



## Getting LocalPlayer (LocalScript) <a href="#getting-localplayer-localscript" id="getting-localplayer-localscript"></a>

```lua
local Players = game:GetService("Players")
local LocalPlayer = Players.LocalPlayer
```



## Getting Humanoid from Player <a href="#getting-humanoid-from-player" id="getting-humanoid-from-player"></a>

```lua
local Character = Player.Character
local Humanoid = Character:FindFirstChild("Humanoid")
local HumanoidRootPart = Character:FindFirstChild("HumanoidRootPart")
```



## Getting Player from Humanoid <a href="#getting-player-from-humanoid" id="getting-player-from-humanoid"></a>

```lua
local Character = Humanoid.Parent
local Player = Players:GetPlayerFromCharacter(Character)
```
