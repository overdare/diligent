# Server-Client Communication

## Overview <a href="#overview" id="overview"></a>

OVERDARE’s world operates based on communication between the server and the client.

<div align="left"><figure><img src="../../../.gitbook/assets/Group 11.png" alt=""><figcaption></figcaption></figure></div>

* The **server** manages the global state of the game and acts as the **central system** that handles communication with all clients (players).
* The **client** is a **local environment** that runs on an individual player’s device, handling player input, visual effects, UI, and more.



Since the server and client operate independently, in a multiplayer game, **game logic**, **camera control**, and **player input handling** must be implemented and communicated using **RemoteEvent**.



## Types of Communication <a href="#types-of-communication" id="types-of-communication"></a>

Since the server and client have different functionalities, communication between them requires the use of **RemoteEvent**.

For example, GUI elements like buttons are processed only on the client-side, while game logic must be handled on the server-side. In other words, when a skill button click occurs on the client, it needs to send an event to the server to request that the server processes the skill usage logic.

RemoteEvent connects the roles of the server and client, enabling core interactions in multiplayer games.



<table><thead><tr><th width="273">Communication Type</th><th width="99">Sender</th><th width="101">Receiver</th><th>Example</th></tr></thead><tbody><tr><td>Event sent from the sever to all clients</td><td>Server</td><td>Client</td><td>Game Over</td></tr><tr><td>Event sent from the server to a specific client</td><td>Server</td><td>Client</td><td>Display level-up UI on level-up</td></tr><tr><td>Event sent from the client to the server</td><td>Client</td><td>Server</td><td>Skill button click</td></tr></tbody></table>



## RemoteEvent Object <a href="#remoteevent-object" id="remoteevent-object"></a>

**RemoteEvent** is an object provided to handle events between the server and client, supporting **one-way communication**.

For communication between the server and client, the RemoteEvent object must be **accessible from both sides**. To achieve this, **RemoteEvent** is placed in **ReplicatedStorage**, a storage where the server and client can share data. ReplicatedStorage safely synchronizes objects between the server and client, ensuring that the RemoteEvent is accessible in both environments.

![](<../../../.gitbook/assets/image (36).png>)



💡 Tip. To clearly distinguish whether the **RemoteEvent** is for communication from the server to the client (Server to Client) or from the client to the server (Client to Server), it is recommended to use **prefixes** such as **S2C\_** for server-to-client communication and **C2S\_** for client-to-server communication. This makes the event’s role intuitive, enhancing code readability and maintainability.\
![](<../../../.gitbook/assets/image (37).png>)



## Communication Using RemoteEvent <a href="#communication-using-remoteevent" id="communication-using-remoteevent"></a>

You can send **arguments** along with events when firing a RemoteEvent. The arguments are passed when calling the FireServer, FireClient, or FireAllClients methods, and the receiving side can receive the data in a callback function.



### FireAllClients (Server ➡ All Client) <a href="#fireallclients-server-all-client" id="fireallclients-server-all-client"></a>

The server sends an event to **all clients**. This is useful for synchronizing global game states or delivering the same information to all players.



**In Script**

```lua
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage") 
local S2C_GameEnd = ReplicatedStorage:WaitForChild("S2C_GameEnd")

local function TimeOver()
    local isWin = false
    S2C_GameEnd:FireAllClients(isWin) -- Passing arguments
end
```



**In LocalScript**

```lua
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage") 
local S2C_GameEnd = ReplicatedStorage:WaitForChild("S2C_GameEnd")

local function OnGameEnd(isWin)
    print("[OnGameEnd] ", Players.LocalPlayer.Name, " / isWin : ", isWin)
end
S2C_GameEnd.OnClientEvent:Connect(OnGameEnd)
```



### FireClient (Server ➡ Specific Client) <a href="#fireclient-server-specific-client" id="fireclient-server-specific-client"></a>

This method sends an event from the server to a **specific client**. It is used when handling tasks related to an individual player.



**In Script**

```lua
local Players = game:GetService("Players")

local ReplicatedStorage = game:GetService("ReplicatedStorage") 
local S2C_LevelUp = ReplicatedStorage:WaitForChild("S2C_LevelUp")

local function LevelUp(player)
    local prevLevel = 1
    local curLevel = 2
    S2C_LevelUp:FireClient(player, prevLevel, curLevel) -- Passing arguments
end
```



**In LocalScript**

```lua
local Players = game:GetService("Players")

local ReplicatedStorage = game:GetService("ReplicatedStorage") 
local S2C_LevelUp = ReplicatedStorage:WaitForChild("S2C_LevelUp")

local function OnLevelUp(prevLevel, curLevel)
    print("[OnLevelUp] ", Players.LocalPlayer.Name, " / LevelUp : ", prevLevel, " -> ", curLevel)
end
S2C_LevelUp.OnClientEvent:Connect(OnLevelUp)
```



### FireServer (Client ➡ Server) <a href="#fireserver-client-server" id="fireserver-client-server"></a>

This method sends an event from the client to the **server**. It is used when the server needs to handle the user’s input or specific events (e.g., button clicks, skill use requests).



**In LocalScript**

```lua
local ReplicatedStorage = game:GetService("ReplicatedStorage") 
local C2S_UseSkill = ReplicatedStorage:WaitForChild("C2S_UseSkill")

local function ClickSkillButton()
    local skillID = 1
    C2S_UseSkill:FireServer(skillID)
end
```



**In Script**

```lua
local ReplicatedStorage = game:GetService("ReplicatedStorage") 
local C2S_UseSkill = ReplicatedStorage:WaitForChild("C2S_UseSkill")

local function OnUseSkill(player, skillID)
    print("[OnUseSkill] ", player.Name, " / skillID : ", skillID)
end
C2S_UseSkill.OnServerEvent:Connect(OnUseSkill)
```



## Advanced Usage <a href="#advanced-usage" id="advanced-usage"></a>

* Since data sent from the client cannot be trusted, it should always be **validated by the server**.
* Send only the necessary information to the server to reduce network load. (Send **only minimal data** from the client)
* Avoid creating too many RemoteEvents. If tasks can be handled in the same context, process them using a single RemoteEvent.
* Create RemoteEvent connections only when necessary, and **disconnect** when finished to avoid memory leaks. (`Disconnect()` function)
* When using a single RemoteEvent to handle multiple tasks, add the first argument (EventType) to indicate the **task type**. (Example of using EventType: PlayerActionType and ActionID)
