# BindableEvent

## Overview <a href="#overview" id="overview"></a>

BindableEvent can be used to implement communication between servers or between clients within the same environment.



## BindableEvent Object <a href="#bindableevent-object" id="bindableevent-object"></a>

**BindableEvent** is an object provided to handle events within the same environment, supporting **one-way communication**.\
\
![](<../../../.gitbook/assets/image (38).png>)



💡 Tip. To clearly distinguish whether the communication is between Server to Server or Client to Client when using **BindableEvent**, it is recommended to use **prefixes** such as **S2S\_** or **C2C\_** in the name. This makes the event’s role intuitive and improves code readability and maintainability.

![](<../../../.gitbook/assets/image (37).png>)



## Implementing Communication with BindableEvent <a href="#implementing-communication-with-bindableevent" id="implementing-communication-with-bindableevent"></a>

When firing an event with BindableEvent, you can send **arguments** along with it. These arguments are passed when calling the Fire method and can be received by the callback function on the receiving side.



### Server ➡ Server <a href="#server-server" id="server-server"></a>

**In Script1**

```lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local S2S_SomeEvent = ReplicatedStorage:WaitForChild("S2S_SomeEvent")

local function TestFire()
    local SomeText = "BindableEvents"
    S2S_SomeEvent:Fire(SomeText) -- Passing arguments
end
```



**In Script2**

```lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local S2S_SomeEvent = ReplicatedStorage:WaitForChild("S2S_SomeEvent")

local function OnSomeEvent(text)
    print("[SomeEvent]", "Parameter : ", text)
end
S2S_SomeEvent.Event:Connect(OnSomeEvent)
```



### Client ➡ Client <a href="#client-client" id="client-client"></a>

**In LocalScript1**

```lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local C2C_SomeEvent = ReplicatedStorage:WaitForChild("C2C_SomeEvent")

local function TestFire()
    local SomeText = "BindableEvents"
    C2C_SomeEvent:Fire(SomeText) -- Passing arguments
end
```



**In LocalScript2**

```lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local C2C_SomeEvent = ReplicatedStorage:WaitForChild("C2C_SomeEvent")

local function OnSomeEvent(text)
    print("[SomeEvent]", "Parameter : ", text)
end
C2C_SomeEvent.Event:Connect(OnSomeEvent)
```
