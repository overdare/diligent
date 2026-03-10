# Mobile Input Handling

## Overview <a href="#overview" id="overview"></a>

ContextActionService helps effectively manage various input methods such as keyboard, mouse, and touch during gameplay, making it easy to implement context-sensitive interfaces. It allows you to manage player input conveniently and flexibly assign or remove actions based on the game’s context.



## Features <a href="#features" id="features"></a>

* Can handle multiple input devices such as **keyboards, mice, and touch** in the same way.
* Compatible with both **OVERDARE Studio** environments on PC and **mobile** platforms, simplifying input handling.
* Can enable only the necessary inputs depending on specific situations, such as menu screens or gameplay.
* Provides the ability to distinguish input states via **UserInputState**, allowing for detailed configuration of actions.



## How to Use <a href="#how-to-use" id="how-to-use"></a>

### 1. Creating an Action <a href="#creating-an-action" id="creating-an-action"></a>

You can create an action using the **BindAction function** in a LocalScript. When creating the action, you can specify the action’s name, whether to create a TouchButton, and the input key to be used on the PC.

```lua
local ContextActionService = game:GetService("ContextActionService")

local ActionName = "JumpAction"
local IsCreateTouchButton = true
local KeyCode = Enum.KeyCode.F

local function OnAction(actionName, inputState, inputObject)
    if inputState == Enum.UserInputState.Begin then
        print(actionName .. " triggered!")
    end
end
ContextActionService:BindAction(ActionName, OnAction, IsCreateTouchButton, KeyCode)
```

<figure><img src="../../../.gitbook/assets/image (39).png" alt=""><figcaption></figcaption></figure>



The created action can have its text, button image, and position set as follows.

```lua
ContextActionService:SetTitle(ActionName, "TEST")
ContextActionService:SetImage(ActionName, "ovdrassetid://1234")
ContextActionService:SetPosition(ActionName, UDim2.new(0.5, 0, 0.8, 0))
```

<figure><img src="https://stackedit.io/.gitbook/assets/image%20(1)%20(1)%20(1)%20(1)%20(1)%20(1)%20(1)%20(1)%20(1)%20(1)%20(1)%20(1)%20(1)%20(1)%20(1)%20(1)%20(1)%20(1)%20(1)%20(1).png" alt=""><figcaption></figcaption></figure>

### 2. Disabling an Action <a href="#disabling-an-action" id="disabling-an-action"></a>

When a specific action is no longer needed, such as disabling the attack button when entering a shop, you can deactivate it using the **UnbindAction function**.

```lua
local ContextActionService = game:GetService("ContextActionService")
local ActionName = "JumpAction"

ContextActionService:UnbindAction(ActionName)
```



### 3. Handling Input States <a href="#handling-input-states" id="handling-input-states"></a>

You can implement handling for different input states such as input begin, input change, and input end using **UserInputState**.

```lua
local function OnAction(actionName, inputState, inputObject)
    if inputState == Enum.UserInputState.Begin then
        print("Begin!")
        
    elseif inputState == Enum.UserInputState.Change then
        print("Change!")
        
    elseif inputState == Enum.UserInputState.End then
        print("End!")
        
    elseif inputState == Enum.UserInputState.Cancel then
        print("Cancel!")
    end
end
ContextActionService:BindAction(ActionName, OnAction, IsCreateTouchButton, KeyCode)
```

<table><thead><tr><th width="152">Type</th><th>Description</th></tr></thead><tbody><tr><td>Begin</td><td>When the input starts</td></tr><tr><td>Change</td><td>When the input is ongoing</td></tr><tr><td>End</td><td>When the input ends</td></tr><tr><td>Cancel</td><td>When the input is interrupted (e.g., when the input point moves out of the button area)</td></tr></tbody></table>



### 4. Retrieving a Specific Action <a href="#retrieving-a-specific-action" id="retrieving-a-specific-action"></a>

You can retrieve a specific button using the **GetButton function**.

```lua
local ActionButton = ContextActionService:GetButton(ActionName)
```



### 5. Retrieving All Created Actions <a href="#retrieving-all-created-actions" id="retrieving-all-created-actions"></a>

You can retrieve all buttons using the **GetAllBoundActionInfo function**.

```lua
local ContextActionService = game:GetService("ContextActionService")
local AllActions = ContextActionService:GetAllBoundActionInfo()

for actionName, actionInfo in pairs(AllActions) do
    print("Action Name : ", actionName)
    print("Input Types : ", actionInfo.InputTypes) 
end
```



## Default Input Handling

### Mobile Joystick, Jump Button Display Control

You can control the visibility of the mobile joystick and jump button using the **SetCoreGuiEnabled function**.

```lua
local StarterGui = game:GetService("StarterGui")

StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.Joystick, false)
StarterGui:SetCoreGuiEnabled(Enum.CoreGuiType.JumpButton, false)
```



### Mobile Screen Touch Detection <a href="#mobile-screen-touch-detection" id="mobile-screen-touch-detection"></a>

Use the **TouchStarted, TouchMoved, and TouchEnded** **events** to process touch start, movement, and end actions. In the function that connects these events, the input and \_gameProcessed variables are delivered as parameters.



* input: An object containing information related to the touch input point, status, location, etc.
* \_gameProcessed: Returns “true” if the input location overlaps with the UI elements specified below.
  * Native UI, such as the chat window
  * Basic control buttons, such as the joystick and jump button
  * GUI buttons for which “Active” is “true”
  * Actions bound to “BindAction”

```lua
local UserInputService = game:GetService("UserInputService")
local ActiveTouches = {} -- Table for individually processing multiple touch inputs that occur simultaneously

local function OnScreenTouchStart(input, _gameProcessed)
    local keyCode = input.KeyCode    
    if keyCode == Enum.KeyCode.Joystick then
        return
    end
    
    table.insert(ActiveTouches, input)
    
    local inputState = input.UserInputState -- Begin
    local inputType = input.UserInputType   -- Touch
    local delta = input.Delta
    local pos = input.Position    

    -- Do Something
end
UserInputService.TouchStarted:Connect(OnScreenTouchStart)

local function OnScreenTouchMove(input, _gameProcessed)
    local keyCode = input.KeyCode    
    if keyCode == Enum.KeyCode.Joystick then
        return
    end
        
    for i = 1, #ActiveTouches do
        -- Searches for touches that correspond to the current input among multiple touch inputs
        if input == ActiveTouches[i] then
            local inputState = input.UserInputState -- Change
            local inputType = input.UserInputType   -- Touch
            local delta = input.Delta
            local pos = input.Position            
            
            -- Do Something
        end
    end
end
UserInputService.TouchMoved:Connect(OnScreenTouchMove)

local function OnScreenTouchEnd(input, _gameProcessed)
    local keyCode = input.KeyCode    
    if keyCode == Enum.KeyCode.Joystick then
        return
    end

    local i
    for j = 1, #ActiveTouches do
        if input == ActiveTouches[j] then
            i = j
            break        
        end
    end
    
    local inputState = input.UserInputState -- End
    local inputType = input.UserInputType   -- Touch
    local delta = input.Delta
    local pos = input.Position 

    -- Do Something

    table.remove(ActiveTouches, i)
end
UserInputService.TouchEnded:Connect(OnScreenTouchEnd)
```



### Mobile Joystick Input Detection <a href="#mobile-joystick-input-detection" id="mobile-joystick-input-detection"></a>

```lua
local UserInputService = game:GetService("UserInputService")

local function OnJoystickStart(input, _gameProcessed)
    local keyCode = input.KeyCode
    if keyCode ~= Enum.KeyCode.Joystick then
        return
    end
    
    local inputState = input.UserInputState -- Begin
    local inputType = input.UserInputType   -- Touch     
    local delta = input.Delta
    local pos = input.Position
    
    -- Do Something
end
UserInputService.TouchStarted:Connect(OnJoystickStart)

local function OnJoystickMove(input, _gameProcessed)   
    local keyCode = input.KeyCode
    if keyCode ~= Enum.KeyCode.Joystick then
        return
    end
    
    local inputState = input.UserInputState -- Change
    local inputType = input.UserInputType   -- Touch 
    local delta = input.Delta
    local pos = input.Position
    
    -- Do Something
end
UserInputService.TouchMoved:Connect(OnJoystickMove)

local function OnJoystickEnd(input, _gameProcessed)   
    local keyCode = input.KeyCode    
    if keyCode ~= Enum.KeyCode.Joystick then
        return
    end
    
    local inputState = input.UserInputState -- Change
    local inputType = input.UserInputType   -- Touch 
    local delta = input.Delta
    local pos = input.Position
    
    -- Do Something
end
UserInputService.TouchEnded:Connect(OnJoystickEnd)
```
