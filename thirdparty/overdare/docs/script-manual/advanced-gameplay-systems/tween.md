# Tween

## Overview <a href="#overview" id="overview"></a>

Tween is used to smoothly and naturally change the properties of an object. By using Tween, various properties such as the object’s position, rotation, and size can be animated, adding immersive and rich visual effects to the game.



## Features <a href="#features" id="features"></a>

* Tweens excel in both code simplicity and performance, helping to easily implement various effects.
* Tweens support various **Easing styles**, providing smooth and natural animations.
* Tweens are processed internally in an efficient manner, and their performance overhead is lower compared to frame-by-frame updates.
* Tweens automatically terminate once completed, and subsequent tasks can be easily handled in **the Completed event**.



## Components <a href="#components" id="components"></a>

* **TweenService**: The service used to create and manage tweens.
* **TweenInfo**: An object that defines how the tween behaves, including settings for duration, direction, and repeat count.
* **TweenGoals**: Defines the property values to be changed by the tween.



## How to Use <a href="#how-to-use" id="how-to-use"></a>

### 1. Creating a Tween <a href="#creating-a-tween" id="creating-a-tween"></a>

You can define the behavior of a tween animation, such as its duration, easing style, and repeat count, using the **TweenInfo.new function**.

The properties to which the animation will be applied, such as the object’s position or rotation, are set in the **TweenGoals table**.

```lua
local TweenService = game:GetService("TweenService")
local Part = script.Parent

-- Setting Tween information
local TweenInfoData = TweenInfo.new(
    2,                        -- Easing duration (seconds)
    Enum.EasingStyle.Linear,  -- Easing style
    Enum.EasingDirection.Out, -- Easing direction
    0,                        -- Number of repetitions (-1 for infinite) 
    false,                    -- Whether to reverse
    0                         -- Wait time
)

-- Properties to be changed with the tween
local TweenGoals = 
{
    Position = Vector3.new(-400, 50, -350)
}

local Tween = TweenService:Create(Part, TweenInfoData, TweenGoals)
```



### 2. Setting Properties to Be Changed With the Tween <a href="#setting-properties-to-be-changed-with-the-tween" id="setting-properties-to-be-changed-with-the-tween"></a>

The functionality of the tween varies depending on the properties set in the TweenGoals.

<table><thead><tr><th width="180.6666259765625">DataType</th><th> Usage Example</th></tr></thead><tbody><tr><td>CFrame</td><td>CFrame</td></tr><tr><td>Vector3</td><td>Position, Orientation, Size</td></tr><tr><td>Color3</td><td>Color</td></tr><tr><td>number</td><td>Transparency</td></tr><tr><td>bool</td><td>CanCollide</td></tr><tr><td>UDim2</td><td>Position, Size</td></tr></tbody></table>



### 3. Running the Tween <a href="#running-the-tween" id="running-the-tween"></a>

You can create a tween by passing the target object, the pre-configured **TweenInfo**, and **TweenGoals** to the **TweenService:Create function**. Once the tween is created, it can be executed using the **Play function**.

```lua
local TweenService = game:GetService("TweenService")
local Part = script.Parent

-- Setting Tween information
local TweenInfoData = TweenInfo.new(
    2,                        -- Easing duration (seconds)
    Enum.EasingStyle.Linear,  -- Easing style
    Enum.EasingDirection.Out, -- Easing direction
    0,                        -- Number of repetitions (-1 for infinite) 
    false,                    -- Whether to reverse
    0                         -- Wait time
)

-- Properties to be changed with the tween
local TweenGoals = 
{
    Position = Vector3.new(-400, 50, -350)
}

local Tween = TweenService:Create(Part, TweenInfoData, TweenGoals)

Tween:Play()
```



### 4. Controlling the Tween Execution <a href="#controlling-the-tween-execution" id="controlling-the-tween-execution"></a>

A tween that is running can be paused using the **Pause function**.

```lua
...
Tween:Pause() -- Pause
wait(2)​
Tween:Play()  -- Resume
```



The **Cancel function** can be used to cancel a running tween.

```lua
...
Tween:Cancel()
```



### 5. Handling Events After the Tween Ends <a href="#handling-events-after-the-tween-ends" id="handling-events-after-the-tween-ends"></a>

The **Completed event** can be used to handle actions after a tween finishes executing.

```lua
local TweenService = game:GetService("TweenService")
local Part = script.Parent

-- Setting Tween information
local TweenInfoData = TweenInfo.new(
    2,                        -- Easing duration (seconds)
    Enum.EasingStyle.Linear,  -- Easing style
    Enum.EasingDirection.Out, -- Easing direction
    0,                        -- Number of repetitions (-1 for infinite) 
    false,                    -- Whether to reverse
    0                         -- Wait time
)

-- Properties to be changed with the tween
local TweenGoals = 
{
    Position = Vector3.new(-400, 50, -350)
}

local Tween = TweenService:Create(Part, TweenInfoData, TweenGoals)

local function OnCompleted(playbackState)
    print("Tween Complete!", playbackState)
end
Tween.Completed:Connect(OnCompleted)

Tween:Play()
```



## EasingStyle

<figure><img src="../../../.gitbook/assets/1_EasingStyle.gif" alt=""><figcaption></figcaption></figure>



## EasingDirection

<figure><img src="../../../.gitbook/assets/EasingDirection.gif" alt=""><figcaption></figcaption></figure>
