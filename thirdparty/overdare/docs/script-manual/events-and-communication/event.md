# Event

## Overview <a href="#overview" id="overview"></a>

Events are used to implement necessary functions for various situations that occur within the game (such as entering, collisions, etc.).

<figure><img src="../../../.gitbook/assets/Bind Event Diagram (1).png" alt="" width="509"><figcaption></figcaption></figure>



## Linking a Function to an Event <a href="#linking-a-function-to-an-event" id="linking-a-function-to-an-event"></a>

Use `:Connect()` to link a function to an event.

```lua
local Part = script.Parent

local function OnTouched(otherPart)
  print("otherPart : ", otherPart.Name)
end
Part.Touched:Connect(OnTouched)
```



## Unlinking a Function from an Event <a href="#unlinking-a-function-from-an-event" id="unlinking-a-function-from-an-event"></a>

If you store the returned value in a variable when you use `:Connect()` to link a function to an event, you can unlink the function from the event when it is no longer needed.

```lua
local Part = script.Parent
local Connection = nil

local function OnTouched(otherPart)
    local partParent = otherPart.Parent
    local humanoid = partParent:FindFirstChild("Humanoid")
 
    if humanoid then
        if Connection ~= nil then
            Connection:Disconnect()	
        end
    end
end
Connection = Part.Touched:Connect(OnTouched)
```



## Waiting for an Event

Using Wait() blocks the current thread until the signal fires once, then returns the arguments that were passed when it fired. The examples below show how to use those return values or chain waits in more involved flows.



When a player joins, wait for their character to be ready, then initialize Humanoid (Server)

```lua
local Players = game:GetService("Players")

local function OnPlayerAdded(player)
    local character = player.Character or player.CharacterAdded:Wait()
    local humanoid = character:WaitForChild("Humanoid")
    humanoid.WalkSpeed = 16
end
Players.PlayerAdded:Connect(OnPlayerAdded)
```



Use the instance returned by Wait() for follow-up work

```lua
local Folder = workspace:FindFirstChild("SpawnContainer")
local AddedChild = Folder.ChildAdded:Wait()
local Nested = AddedChild:FindFirstChild("Config")

if Nested and Nested:IsA("ModuleScript") then
    -- load module or other follow-up logic
end
```



Signals that return multiple values: AncestryChanged passes (child, parent)

```lua
local Part = workspace:FindFirstChild("MovingPart")
Part.Parent = nil
Part.Parent = workspace.TargetFolder

local Child, NewParent = Part.AncestryChanged:Wait()

if NewParent then
    print("New Parent: ", NewParent:GetFullName())
end
```



Wait once for server-sent data via RemoteEvent, then run logic (Client)

```lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RemoteEvent = ReplicatedStorage:FindFirstChild("SessionReady")

if RemoteEvent then
    local sessionId, startTime = RemoteEvent.OnClientEvent:Wait()
    -- use sessionId, startTime for UI update or game logic
end
```



## Commonly Used Events <a href="#commonly-used-events" id="commonly-used-events"></a>

### Collision Events <a href="#collision-events" id="collision-events"></a>

Detects objects that collide with an object to which the event is linked.\
(For example: Detecting characters that touch a Kill Part)

```lua
local Part = script.Parent
local Connection = nil

local function OnTouched(otherPart)
    local partParent = otherPart.Parent
    local humanoid = partParent:FindFirstChild("Humanoid")
 
    if humanoid then
        if Connection ~= nil then
            Connection:Disconnect()	
        end
    end
end
Connection = Part.Touched:Connect(OnTouched)
```



Detects objects that exit the area (collision range) of the object to which the event is linked.\
(For example: Escaping from a trap floor)

```lua
local function OnTouchEnded(otherPart)
    print("TouchEnded : ", otherPart.Name)
end
part.TouchEnded:Connect(OnTouchEnded)
```



### Update Events <a href="#update-events" id="update-events"></a>

An event that is called every frame.\
(For example: Timer calculations, object movement, physics operations)

```lua
local RunService = game:GetService("RunService")
local Timer = 0

local function UpdateEvent(deltaTime)
    Timer = Timer + deltaTime
    
    if Timer >= 3 then
        Timer = 0
        print("Reset!)
    end
end
RunService.Heartbeat:Connect(UpdateEvent)
```



### Player Join/Leave Events <a href="#player-joinleave-events" id="player-joinleave-events"></a>

An event that detects players who join the game.

```lua
local Players = game:GetService("Players")

local function EnterPlayer(player)
    print("EnterPlayer : ", player.Name)
end
Players.PlayerAdded:Connect(EnterPlayer)
```



An event that detects players who leave the game.

```lua
local Players = game:GetService("Players")

local function LeavePlayer(player)
    print("LeavePlayer : ", player.Name)
end
Players.PlayerRemoving:Connect(LeavePlayer) 
```



### Character Spawn/Death Events <a href="#character-spawndeath-events" id="character-spawndeath-events"></a>

These are events that detect when a character is spawned or when a character dies.

```lua
local Players = game:GetService("Players")

local function EnterPlayer(player)
    -- Spawn
    local function SpawnCharacter(character)    
        local humanoid = character:WaitForChild("Humanoid")
        
        -- Die
        local function DeathCharacter()
            print(player.Name, "Die!")
        end
        humanoid.Died:Connect(DeathCharacter)
    end
    player.CharacterAdded:Connect(SpawnCharacter)
end
Players.PlayerAdded:Connect(EnterPlayer)
```



### Button Click Events <a href="#button-click-events" id="button-click-events"></a>

An event that is triggered when a button is clicked.

```lua
local ScreenGui = script.Parent
local Button = ScreenGui.TextButton

local function OnActivated()
    print("Activated")
end
Button.Activated:Connect(OnActivated)
```
