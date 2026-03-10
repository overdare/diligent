# Unity Developer Guide

## Overview <a href="#overview" id="overview"></a>

OVERDARE is a powerful **game creation platform** that handles everything from **multiplayer game development** to **deployment**. Unlike Unity which is client-based, OVERDARE is designed for multiplayer environments, resulting in a different structure than Unity.

This document is designed to help Unity developers quickly adapt to OVERDARE Studio. Explore **new possibilities** for creating multiplayer games with OVERDARE!



## Interface <a href="#interface" id="interface"></a>

<figure><img src="../../.gitbook/assets/unity-developer-guide-1.png" alt=""><figcaption><p>Unity / OVERDARE Studio</p></figcaption></figure>

| Unity     | OVERDARE      |
| --------- | ------------- |
| Game      | X             |
| Scene     | Viewport      |
| Hierarchy | Level Browser |
| Inspector | Properties    |
| Project   | X             |
| Console   | Output Log    |



Unlike Unity, OVERDARE Studio does not provide a Game View or Project panel. Instead, when you run the game, **the Viewport panel switches to the play screen**.

In Unity, all assets such as scripts, materials, and meshes are managed in the Project panel. In OVERDARE Studio, scripts are managed in the **Level Browser**, while externally imported assets like meshes, images, and audio are managed separately through the **Asset Manager**.



## Shortcut Differences <a href="#keyboard-shortcuts" id="keyboard-shortcuts"></a>

| Unity    | OVERDARE   | 기능          |
| -------- | ---------- | ----------- |
| Q        | Ctrl + 1   | Select Tool |
| W        | Ctrl + 2   | Move Tool   |
| E        | Ctrl + 3   | Rotate Tool |
| R        | Ctrl + 4   | Scale Tool  |
| Ctrl + P | F5         | Play        |
| Ctrl + P | Shift + F5 | Stop        |



## 3D World Coordinate System

<figure><img src="../../.gitbook/assets/Group 116.png" alt=""><figcaption><p>Unity / OVERDARE Studio</p></figcaption></figure>

Unity and OVERDARE have similar coordinate system structures in that the X and Y axes point in the same directions, but there is a difference in the **direction of the Z-axis**. In Unity, the **forward direction is +Z**, while in OVERDARE, the **forward direction is -Z**. This difference is important because it means the reference axis for setting the forward direction of characters and cameras, as well as for calculating movement and rotation, is reversed.



## Importing Assets

<figure><img src="../../.gitbook/assets/unity-developer-guide-2.png" alt=""><figcaption><p>Unity / OVERDARE Studio</p></figcaption></figure>

In client-based Unity, external assets can be easily imported via drag-and-drop. On the other hand, OVERDARE Studio is designed as a **platform for creators**, requiring a **server upload** process when using external assets. This allows creators to easily share assets and use them in game development.

To import external assets, click the **Import button** in the top menu of OVERDARE Studio. When an asset is imported, it is uploaded to the server, and **once processing is complete, it appears in the Asset Drawer**.



### Dynamic Resource Loading

In Unity, resources can be loaded at runtime using **Resources.Load**, which loads assets located in the Resources folder within the Project panel by specifying their path. For example, you might use Resources.Load to load a texture asset and then apply it to a material.

In contrast, OVERDARE references external assets through a unique **Asset Id** assigned to each asset. Rather than assigning the texture itself to the mesh, OVERDARE sets the Asset Id of the texture. This difference stems from the fundamental system distinction between Unity, which focuses on editor-based internal resource management, and OVERDARE, which is centered around a **network-based external resource reference structure**.



Learn More

{% content-ref url="../studio-manual/asset-and-resource-creation/asset-import.md" %}
[asset-import.md](../studio-manual/asset-and-resource-creation/asset-import.md)
{% endcontent-ref %}



## Object Structure Differences

<figure><img src="../../.gitbook/assets/unity-developer-guide-3.png" alt=""><figcaption><p>Unity / OVERDARE Studio</p></figcaption></figure>

In Unity, core functionalities are component-based, allowing you to freely combine components like cameras, colliders, and audio to define an object’s behavior. In contrast, OVERDARE Studio has **fixed object types for specific functionalities**.

For example, in Unity, you need to add a Rigidbody component to enable physics for an object. In OVERDARE Studio, you need to disable the Anchored property in a Part object that has built-in physics functionality.



### Transform

In Unity, you directly control the Position, Rotation, and Scale properties using the **Transform component**, and you can clearly distinguish between local and world coordinate systems.

In OVERDARE, while Position and Orientation are also provided, typically the **CFrame** is used to handle position and rotation together, and scale is managed separately in the Size property. Notably, OVERDARE generally performs all position and rotation operations **relative to the world coordinate system**, and you need to manually calculate transformations if you want to use local coordinates.

This highlights the structural difference in how Unity has clearly separated properties for each component, while OVERDARE groups position and rotation together in a single CFrame.



Learn More

{% content-ref url="../studio-manual/get-started/coordinate-system.md" %}
[coordinate-system.md](../studio-manual/get-started/coordinate-system.md)
{% endcontent-ref %}



### Collision

In Unity, you use the **Collider component** for physics-based collision detection, and you can choose from various collider types such as BoxCollider, SphereCollider, and MeshCollider. For collisions to work, objects need both a Collider and a Rigidbody, and you can use the **isTrigger option** to set triggers. Collision events are detected via callbacks like OnCollisionEnter and OnTriggerEnter, and you can use collision groups or layer masks for detailed filtering.

In OVERDARE, all Parts have **built-in collision capabilities** by default, and you control whether they collide using the **CanCollide** property. Instead of OnCollisionEnter or OnTriggerEnter events, all collision events are handled using the **Touched event**. If CanCollide is disabled, it behaves like Unity's trigger events. OVERDARE also allows you to set collision filtering using collision groups.



Learn More

{% content-ref url="../studio-manual/game-development/collision-groups.md" %}
[collision-groups.md](../studio-manual/game-development/collision-groups.md)
{% endcontent-ref %}



### Rigidbody (Physics)

In Unity, adding a **Rigidbody component** to an object allows it to be influenced by the physics engine. You can precisely control the object's motion using properties such as velocity and angularVelocity, as well as methods such as AddForce and AddTorque for force-based interactions.

In OVERDARE, all Parts come with **built-in physics properties** by default. If an object's **Anchored** property is disabled, it will respond to physical effects such as gravity, collisions, and friction. Physics-based motion control is implemented through **dedicated physics objects** such as LinearVelocity, AngularVelocity, and VectorForce.



Learn More

{% content-ref url="../studio-manual/object/physics.md" %}
[physics.md](../studio-manual/object/physics.md)
{% endcontent-ref %}



### Camera

In Unity, you can freely place Camera components in a scene and configure multiple cameras for various purposes, such as scene cameras or UI cameras. A common method is to **switch cameras** that are active by pre-placing several cameras and toggling their SetActive state to change the viewpoint.

In contrast, OVERDARE uses Workspace.CurrentCamera to control the **single active camera**, as only one camera exists in the system and it is always active. By default, this camera follows the player's Humanoid, but by setting the CameraType property to Scriptable, you can directly control the camera's position and rotation. Instead of switching between multiple cameras like in Unity, you change the viewpoint by **directly modifying properties** like CFrame and FieldOfView on the CurrentCamera.



Learn More

{% content-ref url="../studio-manual/object/camera.md" %}
[camera.md](../studio-manual/object/camera.md)
{% endcontent-ref %}



### ParticleSystem

In Unity, you can add a **ParticleSystem component** to an object to create various effects. The ParticleSystem itself has multiple modules such as Emission, Shape, Velocity, and Lifetime, allowing for complex effect combinations.

In contrast, OVERDARE uses **effect objects** like ParticleEmitter, Beam, and Trail, which are attached to Parts. Each effect type is a separate object with limited configurable properties. For example, the ParticleEmitter allows setting properties such as speed, direction, color, and lifetime, but it does not support the multi-module combinations that Unity's system does. Additionally, particles are emitted based on the Part they're attached to, without separate position settings.



Learn More

{% content-ref url="../studio-manual/object/vfx.md" %}
[vfx.md](../studio-manual/object/vfx.md)
{% endcontent-ref %}



### UI

In Unity, the root of the UI system is the **Canvas component**, and all UI elements are placed under this Canvas for rendering. UI elements are typically laid out using RectTransform, and through the use of anchors, pivots, and panel hierarchies, you can design complex and responsive UIs.

In contrast, all OVERDARE UI elements are organized using components such as **ScreenGui** and **SurfaceGui**. ScreenGui is used for fixed UIs like HUDs or menus, and UI elements are positioned using UDim2 values, which combine pixel and scale components.



Learn More

{% content-ref url="../studio-manual/gui.md" %}
[gui.md](../studio-manual/gui.md)
{% endcontent-ref %}



### RectTransform

In Unity, the **RectTransform component** controls the position, size, and alignment of UI elements. Unlike the standard Transform, it is designed specifically for 2D UI, allowing for relative positioning and auto-alignment based on the parent using anchors, pivots, and offsets. It plays a central role in creating responsive UIs within the canvas, and users can dynamically adjust position and size based on screen resolution and parent size.

In OVERDARE, UI elements are managed with Position, Size, and AnchorPoint properties. The **UDim2 type** used for Position and Size allows mixing pixel and scale values, partially replacing Unity properties such as Anchored Position and Stretch.



Learn More

{% content-ref url="../studio-manual/get-started/coordinate-system.md" %}
[coordinate-system.md](../studio-manual/get-started/coordinate-system.md)
{% endcontent-ref %}



## Prefab

In Unity, frequently used objects like monsters or UI slots are set up as **prefabs**, which can be efficiently managed and reused. Prefabs are stored as assets in the **Project panel** and can be dynamically created at runtime using **Instantiate()**. This system emphasizes **reusability** and **maintenance efficiency**, ensuring that any updates to the original prefab are automatically applied to all references.

In contrast, OVERDARE does not have a separate panel like Unity's Project panel, and all objects are managed through the **LevelBrowser (Hierarchy)**. To create dynamic objects, they must be pre-placed in **ServerStorage** and created using **Clone()** to Workspace or elsewhere as needed. This approach focuses on runtime object cloning and security, and objects can be stored safely in ServerStorage as they are only accessible by the server and not the client.



## Animation

In Unity, **animations for every game object including camera, character, and UI** can be created using the **Animation panel**. These animations are organized in the **Animator panel** using a **State Machine**, allowing for visual control through transition conditions and parameters.

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



### Features <a href="#features" id="features"></a>

| Feature                           | Unity (C#)                                                                        | OVERDARE (Luau)                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Explicit data types               | O                                                                                 | X                                                                                       |
| Access modifiers                  | such as private, public, static                                                   | local, global                                                                           |
| Object-Oriented programming (OOP) | Supports OOP through classes, interfaces, inheritance, polymorphism, etc.         | Does not natively support OOP but allows similar implementations using Metatables       |
| Code Structure                    | Class-based; all code is written inside classes, utilizing methods and properties | Simple function-based structure; no classes, uses Tables to organize data and functions |
| Functions                         | Functions are class members                                                       | Functions can be used as variables (First-class functions)                              |
| Collection                        | List, Dictionary, etc.                                                            | Table                                                                                   |
| Switch Statement                  | O                                                                                 | X                                                                                       |
| Single-line Comment               | //                                                                                | --                                                                                      |
| Multi-line Comment                | /\* and \*/                                                                       | --\[\[ and ]]--                                                                         |
| Semicolons                        | Required                                                                          | Optional                                                                                |



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

Since OVERDARE is designed for **multiplayer environments**, the purpose and execution of scripts depend on their location. For example, client-only features like cameras or GUIs run only on the client, whereas game logic or object movements requiring synchronization must be handled on the server. This structure clearly separates the roles of the client and server, ensuring efficient and stable multiplayer behavior.

In Unity, script execution order can be explicitly set using the Script Execution Order settings. In OVERDARE Studio, the execution order is automatically determined based on the **type of script** (e.g., Script or LocalScript) and its **execution location** (e.g., Workspace, ServerScriptService).

<figure><img src="../../.gitbook/assets/unity-developer-guide-4.png" alt=""><figcaption><p>Unity / OVERDARE Studio</p></figcaption></figure>



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



## Script Feature Comparison <a href="#script-feature-comparison" id="script-feature-comparison"></a>

### print <a href="#print" id="print"></a>

{% tabs %}
{% tab title="Unity (C#)" %}
```csharp
using UnityEngine;

public class Example : MonoBehaviour
{
    void Start()
    {
        print("Hello, World!");
    }
}
```
{% endtab %}

{% tab title="OVERDARE (Lua)" %}
```lua
print("Hello, World!")
```
{% endtab %}
{% endtabs %}



### Start Event <a href="#start-event" id="start-event"></a>

{% tabs %}
{% tab title="Unity (C#)" %}
```csharp
using UnityEngine;

public class Example : MonoBehaviour
{
    void Start()
    {
        print("Start!")
    }
}
```
{% endtab %}

{% tab title="OVERDARE (Lua)" %}
```lua
print("Start!")
```
{% endtab %}
{% endtabs %}



### Update Event <a href="#update-event" id="update-event"></a>

{% tabs %}
{% tab title="Unity (C#)" %}
```csharp
using UnityEngine;

public class Example : MonoBehaviour
{
    private float Timer = 0f;

    void Update()
    {
        Timer += Time.deltaTime;
    }
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



### Reference Object <a href="#reference-object" id="reference-object"></a>

{% tabs %}
{% tab title="Unity (C#)" %}
```csharp
using UnityEngine;

public class Example : MonoBehaviour
{
    void Start()
    {
        GameObject object = GameObject.Find("Monster/Orc");
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



### Transform <a href="#transform" id="transform"></a>

{% tabs %}
{% tab title="Unity (C#)" %}
```csharp
using UnityEngine;

public class Example : MonoBehaviour
{
    void Start()
    {
        transform.position = new Vector3(500, 0, 0);
        transform.rotation = new Vector3(0, 90, 0);
        transform.localScale = new Vector3(0.5f, 0.5f, 0.5f);
    }
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



### Collision Event <a href="#collision-event" id="collision-event"></a>

{% tabs %}
{% tab title="Unity (C#)" %}
```csharp
using UnityEngine;

public class Example : MonoBehaviour
{
    private void OnCollisionEnter(Collision collision)
    {
        print("Collision started with : " + collision.gameObject.name);
    }

    private void OnCollisionStay(Collision collision)
    {
        print("Collision ongoing with : " + collision.gameObject.name);
    }

    private void OnCollisionExit(Collision collision)
    {
        Drint("Collision ended with : " + collision.gameObject.name);
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



### Create & Destroy <a href="#create--destroy" id="create--destroy"></a>

{% tabs %}
{% tab title="Unity (C#)" %}
```csharp
using UnityEngine;

public class Example : MonoBehaviour
{
    public GameObject Prefab;

    void Start()
    {
        GameObject newObject = Instantiate(Prefab, new Vector3(300, 0, 0));
        newObject.name = "NewObject";
        newObject.transform.parent = transform;

        Destroy(newObject);
    }
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



### Coroutine

{% tabs %}
{% tab title="Unity (C#)" %}
```csharp
using System.Collections;
using UnityEngine;

public class CoroutineExample : MonoBehaviour
{
    private IEnumerator co;

    void Start()
    {
        co = SomeCoroutine();
        StartCoroutine(co);
        print("2")
    }

    IEnumerator SomeCoroutine()
    {
        Debug.Log("1");
        yield return new WaitForSeconds(2.0f);
        Debug.Log("3");
    }
}
```
{% endtab %}

{% tab title="OVERDARE (Lua)" %}
```lua
local function SomeCoroutine()
    print("1")
    wait(2)
    print("3")
end

local co = coroutine.create(SomeCoroutine)
coroutine.resume(co)  
print("2")
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
