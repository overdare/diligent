# Manage Value

## Overview

By using attribute or value objects, you can **edit values directly in the editor without scripting**, enhancing your work efficiency.&#x20;

While attributes support various data types and are more memory-efficient, making them ideal for performance, value objects are heavier but ideal for reuse and referencing since they're individual instances.



## Attribute

### Overview

By adding attributes in the Properties panel of objects like Part, you can **easily edit values in the editor** without scripting, leading to higher work efficiency.&#x20;

Additionally, because the client can directly access values on the server without using RemoteEvent for direct communication, the network communication structure can be kept simple, and the codebase can be optimized more easily with reduced complexity.&#x20;

Unlike value objects, attributes do not create or destroy separate instances. As a result, they are processed much faster than using Instance.new() or Destroy(), which makes attributes particularly advantageous in scenarios that involve high-frequency operations, large-scale object control, or repeated synchronization—such as dynamically adding or removing values across many objects.



### Supported Data Types

| Data Type  | Supported O/X | Notes |
| ---------- | ------------- | ----- |
| String     | O             |       |
| Boolean    | O             |       |
| Number     | O             |       |
| UDim       | O             |       |
| UDim2      | O             |       |
| BrickColor | O             |       |
| Color3     | O             |       |
| Vector2    | O             |       |
| Vector3    | O             |       |
| CFrame     | O             |       |



### How to Use

When an attribute value is changed **on the server**, the client can read the updated value without requiring a separate RemoteEvent. This simplifies the communication structure and makes the codebase easier to maintain.&#x20;

Additionally, instead of managing key game data (e.g., monster damage, HP, or player scores) through script variables, you can structure and manage this data at the attribute level. This facilitates the debugging process and allows you to visually monitor it through the Level Browser, which can significantly improve development efficiency.&#x20;

In particular, since designers and non-developers can directly modify values or link objects through the Properties window in Studio, this structure is well-suited for collaborative workflows involving non-programmers.

<figure><img src="../../.gitbook/assets/image (146).png" alt=""><figcaption></figcaption></figure>



By connecting the **GetAttributeChangedSignal event** or **AttributeChanged event** to an object with attributes, you can trigger only the necessary processes when the value changes. This greatly improves the visibility of the overall data flow, and makes it easier to manage and debug.

```lua
local Monster = script.Parent

-- Wait for attribute values added in the Properties panel to load.
repeat wait() until Monster:GetAttribute("HP")
	
local Init_MonsterType = Monster:GetAttribute("MonsterType")
local Init_IsElite     = Monster:GetAttribute("IsElite")
local Init_HP          = Monster:GetAttribute("HP")
local MaxHP            = Init_HP
local Init_Damage      = Monster:GetAttribute("Damage")
local Init_MoveSpeed   = Monster:GetAttribute("MoveSpeed")

-- Detect changes to a specific attribute value
local function OnChangedHP()
    local hp = Monster:GetAttribute("HP")
    print("[Server OnChangedHP] " .. hp .. " / " .. MaxHP)
end
Monster:GetAttributeChangedSignal("HP"):Connect(OnChangedHP)

-- Detect changes to any attribute values
local function OnAttributeChanged(attribute)
    print(attribute, "is Changed : ", Monster:GetAttribute(attribute))
end
Monster.AttributeChanged:Connect(OnAttributeChanged)
```



When the Change event for the same attribute is connected in the client, the necessary process is triggered whenever values change.

```lua
-- Detect changes to a specific attribute value
local function OnChangedHP()	
    RefreshMonsterHpUI()
end
Monster:GetAttributeChangedSignal("HP"):Connect(OnChangedHP)

-- Detect changes to any attribute values
local function OnAttributeChanged(attribute)
    ...
end
Monster.AttributeChanged:Connect(OnAttributeChanged)
```



## Value Objects

### Overview

By using value objects like IntValue or StringValue, you can **easily edit values in the editor** without scripting, leading to higher work efficiency.&#x20;

Additionally, because the client can directly access server-side values without using RemoteEvent for direct communication, the network communication structure can be kept simple, and the codebase can be optimized more easily with reduced complexity.&#x20;

Since value objects exist as individual objects, they are generally heavier than attributes and may affect performance when used in large numbers. However, they are advantageous when frequent reuse or reference linking between instances is needed.



### Supported Data Types

| Data Type    |  Supported O/X | Notes                              |
| ------------ | -------------- | ---------------------------------- |
| IntValue     | O              | Integer values only                |
| NumberValue  | O              | Includes integers and float values |
| StringValue  | O              |                                    |
| BoolValue    | O              |                                    |
| ObjectValue  | X              |                                    |
| CFrameValue  | X              |                                    |
| Vector3Value | X              |                                    |
| Color3Value  | X              |                                    |



## How to Use

When a value object’s value is changed by the **server**, the client can read the value directly without using a separate RemoteEvent. This streamlines the communication structure, making the code easier to maintain and debug.

Additionally, instead of managing key game data, such as monster damage, HP, or player scores, through script variables, you can structure and manage this data at the object level. This facilitates the debugging process and allows you to visually monitor through the Level Browser, which can significantly improve development efficiency.

Since designers and non-developers can modify values directly and connect objects through the Studio’s property panel, this structure is effective in collaborative environments with non-programmers.

<figure><img src="../../.gitbook/assets/image (145).png" alt=""><figcaption></figcaption></figure>



By connecting the Changed event to a value object, you can trigger only the necessary processes when the value changes. This greatly improves the visibility of the overall data flow, and makes it easier to manage and debug.

```lua
local Monster = script.Parent
local Parameter = Monster:WaitForChild("Parameter")

-- Wait for value objects to load using WaitForChild before referencing them.
local HP        = Parameter:WaitForChild("HP")
local Damage    = Parameter:WaitForChild("Damage")
local Defense   = Parameter:WaitForChild("Defense")
local MoveSpeed = Parameter:WaitForChild("MoveSpeed")

local MaxHP     = HP.Value

local function OnChangedHP(newValue) 
    print("[Server OnChangedHP] " .. HP.Value .. " / " .. MaxHP)
end
HP.Changed:Connect(OnChangedHP)
```



When the Changed event for the same value object is connected in the client, the corresponding process is triggered whenever the value changes.

```lua
local function OnChangedHP(newValue) 
    RefreshMonsterHpUI()
end
HP.Changed:Connect(OnChangedHP)
```



## Usage Examples

* When the player's HP changes on the server, the client detects the change in value and refreshes the HpBar UI accordingly.
* When the server processes a skill activation, the client detects the change in value and disables the skill button accordingly.
* When the server changes the active state of a certain object, the client detects the change in the value and displays the corresponding UI icon.
* When the server changes the player's state (e.g., stun, knock-out), the client detects the change in value and applies the effect on the screen.



## Important Notes

* To **prevent issues with loading time**, it is recommended to always use **repeat** or **WaitForChild()** when referencing values during initialization.
* Attributes and value objects only synchronize with the client when the **server changes its value**. However, if the client changes their value, it will not be synced with other clients or the server.
* This method is not suitable for handling complex structures or large-scale data, but it works well for **simple status values** or **individual pieces of information**.
* Excessive use of value objects can clutter the Level Browser, and make it difficult to analyze the structure. **Proper folder organization** and **naming conventions** are required.
* If the values change frequently, **excessive use** of the Changed event may impact performance. It is important to disconnect unnecessary connections using **Disconnect()**.
* **Sensitive values that must be secure** should only be stored in server-only areas, such as **ServerScriptService**, to prevent them from being exposed to the client.
