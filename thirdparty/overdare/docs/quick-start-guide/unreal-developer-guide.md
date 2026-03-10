# Unreal Developer Guide

## Overview

OVERDARE is a powerful **game-creation platform** that lets you **build and publish multiplayer games** all in one place. It’s built on Unreal Engine 5, but offers a structure optimized for UGC development, giving you a much gentler learning curve that Unreal 5, a creator-friendly interface, and a streamlined production pipeline.&#x20;

This document is designed to help Unreal developers quickly adapt to OVERDARE Studio. Explore **new possibilities** for creating multiplayer games with OVERDARE!



## Interface

<figure><img src="../../.gitbook/assets/Unreal-and-OV-1 (1).png" alt=""><figcaption><p>Unreal / OVERDARE Studio</p></figcaption></figure>

| Unreal          | OVERDARE      |
| --------------- | ------------- |
| Viewport        | Viewport      |
| Outliner        | Level Browser |
| Details         | Properties    |
| Content Browser | X             |
| Output Log      | Output Log    |



In Unreal, all assets such as scripts, materials, and meshes are managed in the Content Browser panel. In OVERDARE Studio, scripts are managed in the **Level Browser**, while externally imported assets like meshes, images, and audio are managed separately through the **Asset Manager**.



## Shortcut Differences

| Unreal  | OVERDARE   | Function    |
| ------- | ---------- | ----------- |
| Q       | Ctrl + 1   | Select Tool |
| W       | Ctrl + 2   | Move Tool   |
| E       | Ctrl + 3   | Rotate Tool |
| R       | Ctrl + 4   | Scale Tool  |
| Alt + P | F5         | Play        |
| Esc     | Shift + F5 | Stop        |



## 3D World Coordinate System

<figure><img src="../../.gitbook/assets/Unreal-Vs-OVERDARE-Coordinate (1).png" alt=""><figcaption><p>Unreal / OVERDARE Studio</p></figcaption></figure>

Unreal and OVERDARE use different axis configurations, which means their coordinate systems are fundamentally different. Because of this, the reference axis for setting a character or camera’s forward direction, as well as for calculating movement or rotation, may be reversed, and identical operations can produce different results. Therefore, when converting or linking the two coordinate systems, it’s essential to understand the directional differences between each axis and apply the appropriate conversion process.



## Importing Assets

<figure><img src="../../.gitbook/assets/Unreal-and-OV-2.png" alt=""><figcaption><p>Unreal / OVERDARE Studio</p></figcaption></figure>

In client-based Unreal, external assets can be easily imported via drag-and-drop. On the other hand, OVERDARE Studio is designed as a **platform for creators**, requiring a **server upload** process when using external assets. This allows creators to easily share assets and use them in game development.&#x20;

To import external assets, click the **Import button** in the top menu of OVERDARE Studio. When an asset is imported, it is uploaded to the server, and **once processing is complete, it appears in the Asset Drawer**.



## Object Structure Differences

<figure><img src="../../.gitbook/assets/Unreal-and-OV-3.png" alt=""><figcaption><p>Unreal / OVERDARE Studio</p></figcaption></figure>

OVERDARE Studio uses an **object-based structure** similar to Unreal. Each object is built on a type-based system where its role is defined by its intended purpose, and its core functions are pre-configured within the object type itself. As a result, creators control functionality by choosing the appropriate object type and then adjusting its properties.&#x20;

For example, just as Unreal provides physics functionality to a StaticMeshActor through the Simulate Physics option, OVERDARE Studio provides physics behavior to a Part object through the Anchored property.



### Transform

In Unreal, you directly control Position, Rotation, and Scale through the **Transform properties**, and you can clearly distinguish between local and world coordinate systems when working with them.&#x20;

In OVERDARE, while Position and Orientation are also provided, typically the **CFrame** is used to handle position and rotation together, and scale is managed separately in the Size property. Notably, OVERDARE generally performs all position and rotation operations **relative to the world coordinate system**, and you need to manually calculate transformations if you want to use local coordinates.&#x20;

This highlights the structural difference in how Unreal has clearly separated properties for each component, while OVERDARE groups position and rotation together in a single CFrame.



Learn More

{% content-ref url="../studio-manual/get-started/coordinate-system.md" %}
[coordinate-system.md](../studio-manual/get-started/coordinate-system.md)
{% endcontent-ref %}



### Collision

In Unreal, you can configure highly detailed collision behavior through a StaticMeshActor’s **Collision Preset** and **Collision Response**. Each object can assign different reactions, such as **Block/Overlap/Ignore**, to multiple collision channels, and these rules form a **matrix** that enables very fine-grained control. However, this also makes the system more complex and harder to configure.&#x20;

In OVERDARE, all Parts have the **CanCollide** property, which is used to control collisions. All collision events, such as Hit or Overlap, are handled using the **Touched event**. If CanCollide is disabled, it behaves like Overlap events. OVERDARE also allows you to set collision filtering using collision groups.



Learn More

{% content-ref url="../studio-manual/game-development/collision-groups.md" %}
[collision-groups.md](../studio-manual/game-development/collision-groups.md)
{% endcontent-ref %}



### Physics

In Unreal, enabling the **Simulate Physics** property on a StaticMeshActor makes it respond to the Chaos physics engine. You can then control physical behavior by calling functions such as AddForce, AddImpulse, or AddTorque, allowing for natural, force-based motion, impacts, and rotational effects.&#x20;

In OVERDARE, any Part of an object with the **Anchored** property disabled will respond to physical effects such as gravity, collisions, and friction. Physics-based motion control is implemented through **dedicated physics objects** such as LinearVelocity, AngularVelocity, and VectorForce.



Learn More

{% content-ref url="../studio-manual/object/physics.md" %}
[physics.md](../studio-manual/object/physics.md)
{% endcontent-ref %}



### Camera

In Unreal, you can place multiple CameraActors in a scene, and the player’s actual viewpoint is determined by the PlayerCameraManager. It’s common to set up several cameras in advance and **switch between them** to change the player’s perspective.&#x20;

In contrast, OVERDARE uses Workspace.CurrentCamera to control the **single active camera**, as only one camera exists in the system and it is always active. By default, this camera follows the player's Humanoid, but by setting the CameraType property to Scriptable, you can directly control the camera's position and rotation. Instead of switching between multiple cameras like in Unreal, you change the viewpoint by **directly modifying properties** like CFrame and FieldOfView on the CurrentCamera.



Learn More

{% content-ref url="../studio-manual/object/camera.md" %}
[camera.md](../studio-manual/object/camera.md)
{% endcontent-ref %}



### Niagara

In Unreal, the **Niagara system** is used to create advanced particle effects and VFX. Within a Niagara System, you can combine multiple emitters and a wide range of modules, such as Spawn, Update, Render, and Collision, to build highly complex effects.&#x20;

In contrast, OVERDARE uses **effect objects** like ParticleEmitter, Beam, and Trail, which are attached to Parts. Each effect type is a separate object with limited configurable properties. For example, the ParticleEmitter allows setting properties such as speed, direction, color, and lifetime, but it does not support the multi-module combinations that Unreal's system does. Additionally, particles are emitted based on the Part they're attached to, without separate position settings.



Learn More

{% content-ref url="../studio-manual/object/vfx.md" %}
[vfx.md](../studio-manual/object/vfx.md)
{% endcontent-ref %}



### UI

In Unreal, the UI system is built with **UMG (User Widget)** and created using Widget Blueprints. Interfaces are arranged by combining various layout panels, such as Canvas Panel, Vertical/Horizontal Box, and Size Box, and each widget’s position and size are adjusted using anchors, alignment, and offsets.&#x20;

In contrast, all OVERDARE UI elements are organized using components such as **ScreenGui** and **SurfaceGui**. ScreenGui is used for fixed UIs like HUDs or menus, and UI elements are positioned using UDim2 values, which combine pixel and scale components.



Learn More

{% content-ref url="../studio-manual/gui.md" %}
[gui.md](../studio-manual/gui.md)
{% endcontent-ref %}



## Pawn

In Unreal, player-controllable characters are implemented using the **Pawn or Character classes**. A Pawn is the most basic controllable object that can receive player input, while a Character is an extended class that comes with a CapsuleCollider, MovementComponent, animations, and built-in movement logic.&#x20;

In OVERDARE, controllable characters are represented as **Models, which can include a Humanoid**. The Humanoid provides most of the character logic, such as movement, jumping, animations, and health systems, at the engine level. Players automatically own any character model that includes a Humanoid. Basic movement input and camera control are also handled by the Humanoid system, and creators can extend character behavior by adding Parts or modifying Humanoid properties.



Learn More

{% content-ref url="../studio-manual/character/" %}
[character](../studio-manual/character/)
{% endcontent-ref %}



## Actor

In Unreal, the basic building block of the game world is the **Actor**, and every object placed in the world is an extension of it. An Actor has a Transform (position, rotation, scale) and is designed to combine multiple **components** to define its functionality.&#x20;

In OVERDARE, the basic unit of a game object is a **Part or a Model**. A Part is a self-contained object that includes physics, collision, and rendering properties. Unlike Unreal’s component-based approach, a Part is more like a single object with built-in properties. To create more complex functionality, multiple Parts can be grouped into a Model, and behaviors can be extended using scripts, attachments, or constraints.



## Level Sequencer

In Unreal, the **Level Sequencer** lets you create timeline-based scenes, including cutscenes, camera moves, animations, object movement, and lighting changes. By combining multiple tracks, Sequencer can control an Actor’s position and rotation, material parameters, camera transforms, sound playback, and more. It’s widely used as a **cinematic tool** to synchronize multiple objects on a single timeline.&#x20;

In contrast, OVERDARE's **Animation Editor only supports character animation creation**, and editor-based animation creation for UIs or other objects is not currently supported. Additionally, there is no Animator state machine, meaning **all animation playback and control must be implemented directly in scripts**. For example, animations for character movement, attacks, or emotions must be **manually played through code** or managed with logic-based states.



Learn More

{% content-ref url="../studio-manual/asset-and-resource-creation/animation-editor.md" %}
[animation-editor.md](../studio-manual/asset-and-resource-creation/animation-editor.md)
{% endcontent-ref %}

{% content-ref url="../studio-manual/character/character-animation.md" %}
[character-animation.md](../studio-manual/character/character-animation.md)
{% endcontent-ref %}



## Scripting <a href="#scripting" id="scripting"></a>

OVERDARE Studio uses **Luau script** as its scripting language for game development. Luau is a lightweight scripting language known for its easy-to-learn syntax, fast execution speed, and high flexibility. These characteristics make Luau more accessible and productive than C# scripting, allowing both beginners and experienced developers to use it effectively.



### Features

| Feature                           | Unreal (C++)                                                              | OVERDARE (Luau)                                                                         |
| --------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Explicit data types               | O                                                                         | X                                                                                       |
| Access modifiers                  | such as private, public, static                                           | local, global                                                                           |
| Object-Oriented programming (OOP) | Supports OOP through classes, interfaces, inheritance, polymorphism, etc. | Does not natively support OOP but allows similar implementations using Metatables       |
| Code Structure                    | Requires .h / .cpp file structure and class-level design                  | Simple function-based structure; no classes, uses Tables to organize data and functions |
| Functions                         | Class member function-centric                                             | Functions can be used as variables (First-class functions)                              |
| Collection                        | Uses Unreal containers such as TArray, TMap, TSet, etc.                   | Table                                                                                   |
| Switch Statement                  | O                                                                         | X                                                                                       |
| Single-line Comment               | //                                                                        | --                                                                                      |
| Multi-line Comment                | /\* and \*/                                                               | --\[\[ and ]]--                                                                         |
| Semicolons                        | Required                                                                  | Optional                                                                                |



Learn More

{% content-ref url="../script-manual/get-started/basic-guide-to-lua.md" %}
[basic-guide-to-lua.md](../script-manual/get-started/basic-guide-to-lua.md)
{% endcontent-ref %}



### Code Execution Flow <a href="#code-execution-flow" id="code-execution-flow"></a>

Lua scripts are dynamically typed, and the script is executed sequentially from top to bottom. **Forward referencing is not supported**, meaning any functions or variables must be defined before they are referenced. This design characteristic stems from Lua’s focus on simplicity and runtime performance.

```lua
PrintText("Hello, Lua Script!") -- Error (forward referencing not allowed)  

local function PrintText(message)
    print(message)
end  

PrintText("Hello, Lua Script!") -- Works
```



### Accessing Variables/Functions from Other Scripts <a href="#accessing-variablesfunctions-from-other-scripts" id="accessing-variablesfunctions-from-other-scripts"></a>

If variables or functions are declared as **global**, they can be accessed from anywhere. However, since global variables can be modified from anywhere, this can reduce code stability.

```lua
_G.GlobalText = "Hello, World!" -- Declaring a global variable  

-- Declaring a global function
function _G.GlobalFunction()
    print("This is a global function!")
end
```

```lua
print(_G.GlobalText) -- Accessing a global variable
_G.GlobalFunction()  -- Calling a global function
```



To avoid the risks of global variables, you can use **module scripts** to encapsulate variables and functions within a table and return them. This approach is safer than using global variables and helps structure your code.

```lua
local SomeModule = {} -- Creating a table  

-- Module variable
SomeModule.Text = "Hello from module!"  

-- Module function
function SomeModule:Function()
    print("This is a function inside a module!")
end  

return SomeModule -- Returning the table
```

```lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local SomeModule = require(ReplicatedStorage.SomeModule) -- Loading the module  

print(SomeModule.Text) -- Accessing a module variable
SomeModule.Function()  -- Calling a module function
```



Alternatively, you can use BindableEvent to handle communication between scripts in the same environment, such as server-to-server or client-to-client.



Learn More

{% content-ref url="../script-manual/advanced-gameplay-systems/modulescript.md" %}
[modulescript.md](../script-manual/advanced-gameplay-systems/modulescript.md)
{% endcontent-ref %}

{% content-ref url="../script-manual/events-and-communication/bindableevent.md" %}
[bindableevent.md](../script-manual/events-and-communication/bindableevent.md)
{% endcontent-ref %}



### Execution Location and Order <a href="#execution-location-and-order" id="execution-location-and-order"></a>

Since OVERDARE is designed for **multiplayer environments**, the purpose and execution of scripts depend on their location. For example, client-only features like cameras or GUIs run only on the client, whereas game logic or object movements requiring synchronization must be handled on the server. This structure clearly separates the roles of the client and server, ensuring efficient and stable multiplayer behavior.&#x20;

In contrast, Unreal does not rely on location-based execution. Logic in Unreal is primarily event-driven, with the flow determined by the order of calls or event triggers, such as BeginPlay, input events, delegates, or timers.



Learn More

{% content-ref url="../script-manual/get-started/script-overview.md" %}
[script-overview.md](../script-manual/get-started/script-overview.md)
{% endcontent-ref %}



### Server-Client Communication <a href="#server-client-communication" id="server-client-communication"></a>

OVERDARE is designed for multiplayer games, where the game is implemented using a combination of **Script** (executed on the server) and **LocalScript** (executed on the client). Communication between the server and client is handled using **RemoteEvent**.



Learn More

{% content-ref url="../script-manual/events-and-communication/remoteevent.md" %}
[remoteevent.md](../script-manual/events-and-communication/remoteevent.md)
{% endcontent-ref %}



## Script Feature Comparison

### print

{% tabs %}
{% tab title="Unreal (C++)" %}
```cpp
#include "Example.h"

void AExample::BeginPlay()
{
    Super::BeginPlay();
    UE_LOG(LogTemp, Warning, TEXT("Hello, World!"));
}
```
{% endtab %}

{% tab title="OVERDARE (Lua)" %}
```lua
print("Hello, World!")
```
{% endtab %}
{% endtabs %}



### Start Event

{% tabs %}
{% tab title="Unreal (C++)" %}
```cpp
#include "Example.h"

void AExample::BeginPlay()
{
    Super::BeginPlay();
    UE_LOG(LogTemp, Warning, TEXT("Start!"));
}
```
{% endtab %}

{% tab title="OVERDARE (Lua)" %}
```lua
print("Start!")
```
{% endtab %}
{% endtabs %}



### Update Event

{% tabs %}
{% tab title="Unreal (C++)" %}
```cpp
#include "Example.h"

void AExample::Tick(float DeltaTime)
{
    Super::Tick(DeltaTime);
    Timer += DeltaTime;
}
```
{% endtab %}

{% tab title="OVERDARE (Lua)" %}
```lua
local RunService = game:GetService("RunService")
local Timer = 0

local function UpdateEvent(deltaTime)
    Timer = Timer + deltaTime
end
RunService.Heartbeat:Connect(UpdateEvent)
```
{% endtab %}
{% endtabs %}



### Reference Object

{% tabs %}
{% tab title="Unreal (C++)" %}
```cpp
#include "Example.h"
#include "EngineUtils.h" 

void AExample::BeginPlay()
{
    Super::BeginPlay();

    AActor* Found = nullptr;

    for (TActorIterator<AActor> It(GetWorld()); It; ++It)
    {
        if (It->GetName() == TEXT("Orc"))
        {
            Found = *It;
            break;
        }
    }
}
```
{% endtab %}

{% tab title="OVERDARE (Lua)" %}
```lua
local Workspace = game:GetService("Workspace")
local Orc = Workspace.Monster.Orc
```
{% endtab %}
{% endtabs %}



### Transform

{% tabs %}
{% tab title="Unreal (C++)" %}
```cpp
#include "Example.h"

void AExample::BeginPlay()
{
    Super::BeginPlay();

    SetActorLocation(FVector(500.f, 0.f, 0.f));
    SetActorRotation(FRotator(0.f, 90.f, 0.f));
    SetActorScale3D(FVector(0.5f, 0.5f, 0.5f));
}
```
{% endtab %}

{% tab title="OVERDARE (Lua)" %}
```lua
local Part = script.Parent

Part.Position = Vector3.new(500, 0, 0)
Part.Orientation = Vector3.new(0, 90, 0)
Part.Size = Vector3.new(50, 50, 50)
```
{% endtab %}
{% endtabs %}



### Collision Event

{% tabs %}
{% tab title="Unreal (C++)" %}
```cpp
#include "Example.h"
#include "Components/BoxComponent.h"

AExample::AExample()
{
    UBoxComponent* Box = CreateDefaultSubobject<UBoxComponent>(TEXT("Box"));
    RootComponent = Box;

    Box->OnComponentHit.AddDynamic(this, &AExample::OnHit);
    Box->OnComponentBeginOverlap.AddDynamic(this, &AExample::OnBeginOverlap);
    Box->OnComponentEndOverlap.AddDynamic(this, &AExample::OnEndOverlap);
}

void AExample::OnHit(UPrimitiveComponent*, AActor* OtherActor, UPrimitiveComponent*, FVector, const FHitResult&)
{
    if (OtherActor)
    {
        UE_LOG(LogTemp, Warning, TEXT("Collision started with : %s"), *OtherActor->GetName());
    }
}

void AExample::OnBeginOverlap(UPrimitiveComponent*, AActor* OtherActor, UPrimitiveComponent*, int32, bool, const FHitResult&)
{
    if (OtherActor)
    {
        UE_LOG(LogTemp, Warning, TEXT("Collision ongoing with : %s"), *OtherActor->GetName());
    }
}

void AExample::OnEndOverlap(UPrimitiveComponent*, AActor* OtherActor, UPrimitiveComponent*, int32)
{
    if (OtherActor)
    {
        UE_LOG(LogTemp, Warning, TEXT("Collision ended with : %s"), *OtherActor->GetName());
    }
}
```
{% endtab %}

{% tab title="OVERDARE (Lua)" %}
```lua
local Part = script.Parent

local function onTouched(otherPart)
    print(Part.Name, "Touched :", otherPart.Name)
end
Part.Touched:Connect(onTouched)

local function onTouchEnded(otherPart)
    print(Part.Name, "Touch Ended :", otherPart.Name)
end
Part.TouchEnded:Connect(onTouchEnded)
```
{% endtab %}
{% endtabs %}



### Create & Destroy

{% tabs %}
{% tab title="Unreal (C++)" %}
```cpp
#include "Example.h"
#include "Engine/World.h"

void AExample::BeginPlay()
{
    Super::BeginPlay();
    
    if (!PrefabClass) return;

    FActorSpawnParameters Params;
    AActor* NewObj = GetWorld()->SpawnActor<AActor>(PrefabClass, FVector(300.f, 0.f, 0.f), FRotator::ZeroRotator, Params);

    if (!NewObj) return;

    NewObj->SetActorLabel(TEXT("NewObject"));
    NewObj->AttachToActor(this, FAttachmentTransformRules::KeepWorldTransform);
    
    NewObj->Destroy();
}
```
{% endtab %}

{% tab title="OVERDARE (Lua)" %}
```lua
local Workspace = game:GetService("Workspace")
local Part = Workspace.Part

local ClonedPart = Part:Clone()
ClonedPart.name = "NewPart"
ClonedPart.Parent = Part
ClonedPart.Position = Vector3.new(300, 0, 0)

Part:Destroy()
```
{% endtab %}
{% endtabs %}



### SetTimer

{% tabs %}
{% tab title="Unreal (C++)" %}
```cpp
#include "Example.h"
#include "TimerManager.h"

void AExample::BeginPlay()
{
    Super::BeginPlay();

    GetWorld()->GetTimerManager().SetTimer(
        TimerHandle,
        this,
        &AExample::OnTimer,
        2.0f,
        false
    );
}

void AExample::OnTimer()
{
    UE_LOG(LogTemp, Warning, TEXT("Hello, World!"));
}
```
{% endtab %}

{% tab title="OVERDARE (Lua)" %}
```lua
local function SomeCoroutine()
    wait(2)
    print("Hello, World!")
end

local co = coroutine.create(SomeCoroutine)
coroutine.resume(co)  
```
{% endtab %}
{% endtabs %}



## Reference Materials <a href="#reference-materials" id="reference-materials"></a>

To learn more about the scripting features provided by OVERDARE Studio, refer to the documentation below.

{% content-ref url="../../development/api-reference/" %}
[api-reference](../../development/api-reference/)
{% endcontent-ref %}



## Developer Support

Join the [OVERDARE Creator Community Server](https://discord.com/invite/CbxxNTva98) on Discord to actively engage in game development, ask questions, share information, and participate in community activities!
