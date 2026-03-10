# Module Script

## Overview <a href="#overview" id="overview"></a>

A ModuleScript is used to structure and separate common functionalities for reuse. It helps reduce code duplication and makes maintenance more efficient.



## Recommended Execution Locations <a href="#recommended-execution-locations" id="recommended-execution-locations"></a>

* For modules used by **both server and client**: It is common to place them in **ReplicatedStorage** (e.g., referencing a VectorUtil module in both Script and LocalScript).
* For modules used **only by the server**: For security and management purposes, it is recommended to place them in **ServerScriptService** (e.g., referencing a ServerGameConstValue module in a Script).
* For modules used **only by the client**: Depending on the use case, it is recommended to place them in **StarterPlayerScripts** or **StarterCharacterScripts** (e.g., referencing a GUI module in a LocalScript).



## How It Works <a href="#how-it-works" id="how-it-works"></a>

Modules are executed when they are called explicitly (`require`). The results are **cached** upon the first call, and subsequent calls return the same value, which enhances execution efficiency and ensures consistency.



### 1. **Implementing a Module Script**

```lua
local UtilityModule = {}

function UtilityModule.PrintMessage(message)
    print("PrintMessage : " .. message)
end

return UtilityModule
```



### 2. **Referencing & Using a Module Script**

```lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local UtilityModule = require(ReplicatedStorage.UtilityModule)

UtilityModule:PrintMessage("Hello World!")
```



## Module Script Applications <a href="#module-script-applications" id="module-script-applications"></a>

### Utility Class <a href="#utility-class" id="utility-class"></a>

**In ModuleScript**

```lua
local MathUtil = {}

-- Example Function 1
function MathUtil:Sum(...)
    local numList = { ... }
    local result = 0
    
    for i = 1, #numList do
        result = result + numList[i]
    end
    
    return result 
end

-- Example Function 2
function MathUtil:SomeFunc()
    print("SomeFunc")
end

return MathUtil
```



**In Script or LocalScript**

```lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local MathUtil = require(ReplicatedStorage.MathUtil)

local sum = MathUtil:Sum(1, 5, 9, 10)
print(sum)
```



### Data Class <a href="#data-class" id="data-class"></a>

**In ModuleScript**

```lua
local GameConstValue = {}

GameConstValue.RequirePlayerCount = 10
GameConstValue.MaxRound = 5
GameConstValue.RoundLimitTime = 180

return GameConstValue 
```



**In Script or LocalScript**

```lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local GameConstValue = require(ReplicatedStorage.GameConstValue)

local function CheckPlayerCount(playerCount)
    if playerCount >= GameConstValue.RequirePlayerCount then
        print("Ready to start the game")
    end
end
```



### Class Inheritance <a href="#class-inheritance" id="class-inheritance"></a>

**In ModuleScript**

```lua
local MonsterClass = {}
MonsterClass.__index = MonsterClass

function MonsterClass:new(name, hp, dam, def)
    local self = setmetatable({}, MonsterClass)
    self._Name = name
    self._Hp = hp
    self._MaxHp = hp
    self._Dam = dam
    self._Def = def
    
    return self
end

function MonsterClass:Attack()
    print(self._Name, "Attack!")
end

function MonsterClass:Move()
    print(self._Name, "Move!")
end

function MonsterClass:Destroy()
    print(self._Name, "Destroy!")
end

return MonsterClass
```



**In Script or LocalScript**

```lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local MonsterClass = require(ReplicatedStorage.MonsterClass)

local Goblin = MonsterClass:new("Goblin", 100, 10, 5)
local Orc = MonsterClass:new("Orc", 200, 10, 5)

print(Goblin._Name)
print(Orc._Name)

Goblin:Attack()
Orc:Attack()
```
