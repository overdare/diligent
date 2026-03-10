# Roblox Developer Guide

## Overview

OVERDARE is a UGC platform built on **Unreal Engine 5**, specifically designed for game development.&#x20;

This document provides Roblox creators with a clear and concise guide to **key features** and the **differences from Roblox**, helping them quickly understand and adapt to OVERDARE Studio.



## Interface

<figure><img src="../../.gitbook/assets/RB-and-OV-1.png" alt=""><figcaption><p>Roblox / OVERDARE Studio</p></figcaption></figure>

| Roblox        | OVERDARE      |
| ------------- | ------------- |
| Viewport      | Similar       |
| Toolbox       | Asset Drawer  |
| Asset Manager | Similar       |
| Properties    | Similar       |
| Explorer      | Level Browser |
| Output        | Output Log    |



While some panel names differ, the overall interface structure and layout of Roblox and OVERDARE Studio are largely similar.



## Shortcut Differences

| Roblox | OVERDARE | Function    |
| ------ | -------- | ----------- |
| 1      | Ctrl + 1 | Select Tool |
| 2      | Ctrl + 2 | Move Tool   |
| 3      | Ctrl + 3 | Rotate Tool |
| 4      | Ctrl + 4 | Scale Tool  |



## Features

Unlike Roblox, which uses its own engine, OVERDARE Studio is built on Unreal Engine 5, offering Unreal’s signature graphics quality, performance, and some editor features. This enables creators to develop content in a more flexible and intuitive environment.&#x20;

Building on this engine, OVERDARE has evolved into a UGC platform optimized for the **mobile** environment, providing creators with an optimized creation and gameplay experience through its **mobile-focused services**.



### Server–Client Architectural Design

OVERDARE Studio, following Unreal Engine’s design philosophy, **clearly separates the server and client environments** and minimizes replication to enhance security against client-side hacking and data tampering.&#x20;

For Roblox creators, this may feel different because client-side changes are not automatically synchronized to the server. However, this approach provides a more stable and efficient structure in terms of security and performance.&#x20;

In OVERDARE Studio, **server logic must be written in Scripts and client logic in LocalScripts** for a clear separation. This structure reduces unnecessary synchronization and greatly improves **role separation in code** and **maintenance efficiency**. For example, GUI and Camera-related functions must always run in LocalScripts.&#x20;

Overall, this architectural design provides a safer, more optimized development environment, giving creators a foundation to build systematic and scalable projects.



## Similarities

* **Support for Lua-based Luau scripting**: Supports Lua and Luau scripts, providing a familiar language environment and similar Script API structure for a degree of code compatibility.
* **Object-oriented hierarchical structure (Instance System)**: All game elements are managed as objects (Instances) and organized in a tree-like hierarchy, similar to Roblox.
* **Similar coordinate and unit system**: Concepts like CFrame and UDim define object position and size in 3D and 2D spaces. Aside from differences in 3D units, the logical structure functions similarly.
* **Consistent object properties and behavior models**: Core properties and events like CanCollide, Transparency, and Touched work in ways similar to Roblox, with only a few exceptions noted in the API Reference.
* **Similar class and inheritance structure**: Object inheritance and referencing work on principles similar to Roblox, minimizing the learning curve for understanding class structures.
* **Authoritative server network model**: Uses an Authoritative Server approach, where the server has the final say on all game states. This prevents client discrepancies and ensures stable network synchronization via Replication and RPC.
* **Similar state synchronization and management**: Object state changes propagate from server to client, maintaining data integrity and consistency.
* **Event-driven operation model**: Interactions between objects are handled through an Event–Signal structure, functioning similarly to Roblox’s event-triggered model.
* **Consistent development workflow**: The creation process (placing objects in the editor → setting properties → connecting scripts) is similar, making it easy for Roblox creators to adapt.



## Structural Differences

### 3D Coordinate Units

OVERDARE Studio, built on Unreal Engine, uses **real-world scale** for in-game coordinates. Here, **1 unit = 1 cm**, allowing creators to intuitively understand and control object sizes and movement distances in realistic measurements.&#x20;

In contrast, Roblox uses its own unit called a **Stud**, where **1 Stud ≒ 28 cm**. When transferring content from Roblox to OVERDARE, **coordinate scaling** (e.g., 1 Stud → 28 cm) is required. OVERDARE’s unit system, however, offers the advantage of more intuitive measurements.



Learn More

{% content-ref url="../studio-manual/get-started/coordinate-system.md" %}
[coordinate-system.md](../studio-manual/get-started/coordinate-system.md)
{% endcontent-ref %}



### Asset Paths

OVERDARE Studio uses an independent asset management system, distinct from Roblox, identifying assets with a dedicated Asset ID format `ovdrassetid://number`. This system helps prevent cross-platform confusion and ensures consistent asset referencing.



Learn More

{% content-ref url="../studio-manual/asset-and-resource-creation/asset-import.md" %}
[asset-import.md](../studio-manual/asset-and-resource-creation/asset-import.md)
{% endcontent-ref %}



### Avatars

Roblox offers two character models: R6 and R15. R6 consists of six simple parts (head, torso, arms, and legs), while R15 adds joints and subdivided parts for more flexible animations.&#x20;

In contrast, OVERDARE Studio uses a **single standard character structure**. All avatars consist of six main MeshParts (head, torso, arms, and legs) and a Skeleton with **22 Bones**. This skeleton follows Unreal Engine’s bone system for smooth and detailed joint movements.&#x20;

Since OVERDARE uses a unified system, there’s no need for separate rig conversions like R6 and R15. All characters share the same bone structure and animation resources, allowing creators to use a single animation system. This significantly improves production efficiency and compatibility.



Learn More

{% content-ref url="../studio-manual/character/" %}
[character](../studio-manual/character/)
{% endcontent-ref %}



### Humanoid Body Hitboxes

In OVERDARE Studio, humanoids use a **single capsule-shaped collision** by default to optimize world performance. As a result, per-body hitbox functionality is disabled by default. If needed, creators can enable the **HitboxType option** to define precise hit detection for each body part.



Learn More

{% content-ref url="../studio-manual/character/hitbox-options.md" %}
[hitbox-options.md](../studio-manual/character/hitbox-options.md)
{% endcontent-ref %}



### Hierarchical Transform Inheritance

In Roblox, objects in a parent–child hierarchy need to be connected using a Weld instance to move together at runtime.&#x20;

In contrast, OVERDARE Studio follows the **hierarchical transform inheritance** identical to that of Unreal Engine. This means that changes in a parent object’s position, rotation, or size are **automatically propagated to its children at runtime**, allowing natural hierarchical movement without any Weld setup. This enables simpler hierarchies and more efficient object control.



### Models

Like Roblox, a Model instance in OVERDARE Studio is a container that groups multiple objects such as Parts, Attachments, and Scripts. You can perform actions like moving, rotating, or deleting the entire model at once, and it provides a PrimaryPart property to set a specific object as the model’s reference point.&#x20;

However, since OVERDARE Studio follows Unreal Engine’s **hierarchical transform structure**, it uses a **Parent–Child Relationship for structural grouping** unlike Roblox Models, which rely on physical connections (Welds or joints).



Learn More

{% content-ref url="../studio-manual/object/model.md" %}
[model.md](../studio-manual/object/model.md)
{% endcontent-ref %}

{% content-ref url="../../development/api-reference/classes/model.md" %}
[model.md](../../development/api-reference/classes/model.md)
{% endcontent-ref %}



### UI Control

OVERDARE’s UI system is designed so that all 2D/3D UI elements are primarily controlled and rendered on the client side. This includes HUDs or interfaces using ScreenGui, as well as 3D UI like BillboardGui and SurfaceGui, which are managed locally according to each player’s device environment.

In contrast, Roblox often relies on replication and synchronization between server and client for creating and controlling UI objects, while OVERDARE handles UI entirely on the client side.

This means that most visual feedback, such as UI display and input handling, occurs immediately within client-side local scripts. This approach reduces server load, improves input responsiveness, and helps provide a more consistent user experience across platforms like mobile and PC.



## Differences in Features and Properties

### Default Value of Anchored

In OVERDARE Studio, the **default value for Anchored is true**. This minimizes unnecessary physics calculations and optimizes world performance. If needed, you can explicitly disable Anchored to enable physics-based interactions such as falling or collisions.



### Anchoring and Transparency Limits on Humanoid Root Part

Due to Unreal Engine’s structural constraints, unlike Roblox, the HumanoidRootPart cannot use the Anchored property or partial transparency. (Only 0 or 1 values are supported.)



### Humanoid Jump State

In Roblox, the Jumping state is triggered only at the moment of jump input, then immediately transitions to Freefall, and finally changes to Landed upon touching the ground.

In OVERDARE, the Jumping state is maintained during the jump (throughout the animation) and only transitions to Freefall after the animation ends. Landing changes the state to Landed, like in Roblox.



### Rig Builder

Currently, Rig Builder provides only basic features such as appearance modification and animation playback. Runtime functions like movement control using MoveTo() are still under development.



### Animation Editor

OVERDARE Studio’s animation editor offers a workflow similar to Roblox, but some features and behaviors differ due to differences in engine structure and the avatar system.

Currently, features such as IK (Inverse Kinematics), curve graph editing, and easing styles are not supported.



Learn More

{% content-ref url="../studio-manual/asset-and-resource-creation/animation-editor.md" %}
[animation-editor.md](../studio-manual/asset-and-resource-creation/animation-editor.md)
{% endcontent-ref %}



## Unique Features of OVERDARE

### CanClimb Property

Enabling the CanClimb property on a Part designates it as a climbable object for characters. This helps prevent unintended climbing on surfaces where it’s not desired.



### Character Movement Parameters

OVERDARE provides extended properties that allow fine-tuned control over character movement and behavior, including **maximum speed, ground friction, rotation speed, deceleration, and double jump**. This system is based on Unreal Engine’s detailed character parameter structure that supports more precise movement control and physics response than Roblox.&#x20;

Creators can adjust movement, jumping, falling, friction, and other mechanics in detail, allowing them to craft controls and feedback that match the game’s genre or concept.



Learn More

{% content-ref url="../studio-manual/character/character-movement-parameters.md" %}
[character-movement-parameters.md](../studio-manual/character/character-movement-parameters.md)
{% endcontent-ref %}



### Character Ragdoll

In Roblox, creating a ragdoll effect requires complex setup, including rigging, constraints, and collisions. OVERDARE, however, allows the same effect to be achieved simply by changing the Humanoid’s state.

```lua
local Character = script.Parent
local Humanoid = Character.Humanoid

Humanoid:ChangeState(Enum.HumanoidStateType.Ragdoll)
```



Learn More

{% content-ref url="../studio-manual/character/" %}
[character](../studio-manual/character/)
{% endcontent-ref %}



### CameraOffset Property of the Camera

The CameraOffset property in OVERDARE Studio allows you to **set the camera’s relative position regardless of its current state**. This makes it easy to use CameraOffset with character-attached Custom cameras or script-controlled Scriptable cameras to implement effects like CameraShake.



### TPS Strafing System

The TPS Strafing System is a movement method commonly used in third-person shooters (TPS), allowing characters to move naturally relative to the camera direction. OVERDARE Studio provides this feature without the need for complex scripting. **View-locked movement, strafing, diagonal movement, and backward movement** in a TPS perspective can be easily implemented using this system.



Learn More

{% content-ref url="../script-manual/input-and-controls/tps-strafing-system.md" %}
[tps-strafing-system.md](../script-manual/input-and-controls/tps-strafing-system.md)
{% endcontent-ref %}



### VFXPreset

A VFXPreset is an object that allows you to easily apply visual effects, such as fire, explosions, barriers, or healing, by **selecting from pre-defined effects**. This lets creators quickly and consistently implement a variety of visual effects without additional editing.

<figure><img src="../../.gitbook/assets/image (164).png" alt=""><figcaption></figcaption></figure>



Learn More

{% content-ref url="../studio-manual/object/vfx.md" %}
[vfx.md](../studio-manual/object/vfx.md)
{% endcontent-ref %}



### Outline / Fill

Outline and Fill are instances used to emphasize an object’s outline or interior. They function as an expanded and separated version of Roblox’s Highlight feature. By using these two components, you can achieve more detailed control than a single Highlight allows for clearer readability and more effective feedback presentation in your game.



Learn More

{% content-ref url="../studio-manual/object/outline-fill.md" %}
[outline-fill.md](../studio-manual/object/outline-fill.md)
{% endcontent-ref %}



### BlendSpace

BlendSpace is an object that blends multiple animations on a per-object basis, allowing them to transition smoothly depending on the situation. Compared to manually combining multiple animations in Roblox using weight-based blending, BlendSpace offers a more automated and refined approach to handling animation transitions.



Learn More

{% content-ref url="../../development/api-reference/classes/blendspace.md" %}
[blendspace.md](../../development/api-reference/classes/blendspace.md)
{% endcontent-ref %}



### Mobility Property

The Mobility property classifies placed instances in the world as either Static or Movable, optimizing rendering and processing based on the nature of each object. Objects that do not move are set to Static, while those requiring dynamic interaction or animation are set to Movable, helping strike an efficient balance between visual quality and performance.

This allows creators to fine-tune performance according to the project’s goals, genre, and intended presentation, allocating resources only where needed and achieving a more stable, high-quality performance environment.



Learn More

{% content-ref url="../studio-manual/asset-and-resource-creation/mobility.md" %}
[mobility.md](../studio-manual/asset-and-resource-creation/mobility.md)
{% endcontent-ref %}



### Action Sequencer (In Development)

The Action Sequencer is a **timeline-based visual editor** designed to build complex character actions such as dashes, combo attacks, and chained skills.&#x20;

On Roblox, creators must combine animation tracks with scripting to achieve similar effects. In contrast, OVERDARE Studio’s Action Sequencer provides an integrated workflow where **animations, sound, camera work, effects, and events (markers) can all be edited intuitively within a single timeline**.&#x20;

The feature is currently under development and will be released soon.

<figure><img src="../../.gitbook/assets/image (159).png" alt=""><figcaption><p>This image shows a work-in-progress screen. The UI and features may change by the time it is officially released.</p></figcaption></figure>



### Simulation Ball

The Simulation Ball is a ball-type object that runs on **pre-simulated data** rather than a calculation-heavy physics engine. All clients share the same precomputed trajectory data, ensuring identical movement and rotation regardless of network conditions.&#x20;

Because this system is unaffected by server–client latency and does not perform per-frame physics calculations, it delivers **high performance efficiency**. Creators can also instantly query any state in time (position, speed, rotation, etc.) using the simulation data, which guarantees **predictable results and consistent behavior**.

<figure><img src="../../.gitbook/assets/image (162).png" alt=""><figcaption></figcaption></figure>



Learn More

{% content-ref url="../../development/api-reference/classes/simulationball.md" %}
[simulationball.md](../../development/api-reference/classes/simulationball.md)
{% endcontent-ref %}



## Unavailable Features

OVERDARE Studio continues to expand its development tools and editor environment through ongoing updates. The items listed below are major features that are currently unavailable or still under development, and will be rolled out in stages.



### **C**reation & Editor Features

* Terrain Editor / Mesh Editor / Plugin
* Localization
* Server Test
* Teleport



### Physics & Interaction Features

* Weld
* ForceField / ProximityPrompt
* ClickDetector
* Pathfinding
* Seat / VehicleSeat / Motor6D



### Data & Network Features

* ReplicateFirst / StarterPack
* RemoteFunction / BindableFunction
* OrderedDataStore
* TeamService
* PreloadAsync / StreamingEnabled



### Graphics & Rendering Features

* SurfaceAppearance / Post Processing
* TextBox / ViewportFrame / UIStroke / UICorner / UIGradient 등
* UI 9-Slice Design
* RichText
* Skeletal Mesh / Animation Controller



### Other Features

* Parallel execution (Actor)
* Dynamic insertion of Toolbox assets



## Script Behavior Differences

### Reference Clearing by Destroy

When the Destroy() method is called, **any variables referencing that object are automatically set to nil**. The object is then completely removed from memory, and any attempt to access it afterward will trigger a runtime error stating: “Object \[path] has already been destroyed.” When this error occurs, script execution stops, so you should always verify that an object is valid before using it for proper logic processing.&#x20;

Comparisons like `== nil` on a variable after Destroy() are not yet supported. To check whether an object is valid, you must use the **global function isnil()**.

```lua
PartVar:Destroy()

if isnil(PartVar) == true then
    print("The object has already been destroyed.")
end
```



Unlike Roblox, which allows continued access to Destroy() objects, OVERDARE adopts a **safer reference-handling model that uses explicit invalidation and runtime errors**. This prevents unnecessary references and unexpected behaviors, while allowing developers to manage object lifecycles more clearly.



### PlayerAdded Event Behavior

The event system in local scripts has been extended to allow player initialization and character logic to be handled on the client side. Because of this, the **timing of event calls may differ** from Roblox code.&#x20;

In OVERDARE, the PlayerAdded and CharacterAdded events are triggered for every player join and spawn, even within **LocalScripts**.

```lua
Players.PlayerAdded:Connect(function(player)
    print(player.Name .. " joined")
end)
```



When this code runs inside a LocalScript, OVERDARE **triggers the event for all users**, including yourself. In other words, it detects **“you,” “users who joined before you,” and “users who join after you.”**&#x20;

In contrast, in Roblox, the same code inside a LocalScript does not detect yourself or existing users, and the event is only triggered for **users who join after you**. Any initialization or self-related logic must be handled via the server using a RemoteEvent.&#x20;

OVERDARE allows the client to detect all join events directly. This eliminates the need to relay events to the server or wait for responses, significantly reducing server traffic and communication costs. Processing is completed instantly on the client, which leads to faster and more immediate responsiveness without loading delays.&#x20;

However, if you use Roblox code as-is, **differences in event call order** may lead to unexpected behavior. For example, logic in Roblox that only “displays effects for users who join after you” may also trigger for yourself in OVERDARE.

<table><thead><tr><th width="144.333251953125">Category</th><th>Roblox</th><th>OVERDARE</th></tr></thead><tbody><tr><td>Main Purpose</td><td>UI updates, handling users who join late</td><td>Handling all user joins</td></tr><tr><td>Call Scope</td><td>Only users who join after you</td><td>All users, including yourself</td></tr></tbody></table>



### Detecting Touch and Joystick Events

In Roblox, mobile input is handled through a structure where events detected by UserInputService are processed by the ControlModule under the PlayerModule. The ControlModule automatically generates joystick and jump button UI at runtime using modules like TouchThumbstick and TouchJump, and links them to character movement.

In contrast, OVERDARE provides these input controls directly through its API. Touch and joystick inputs can be detected immediately via UserInputService touch events, with event parameters providing information such as input position, state, and type.



Learn More

{% content-ref url="../script-manual/input-and-controls/contextactionservice.md" %}
[contextactionservice.md](../script-manual/input-and-controls/contextactionservice.md)
{% endcontent-ref %}



### Character Position Updates

Unlike Roblox, in OVERDARE, periodically updating the HumanoidRootPart’s Position or CFrame using Heartbeat or a while loop can cause the character to jitter or teleport as the target position conflicts with Unreal’s CharacterMovementComponent.

This happens because Unreal Engine handles character movement internally using a physics-based system and performs collision checks on a per-frame basis. For this reason, handling using repetitive loops is not recommended in OVERDARE.



## Unsupported APIs

Some APIs are still under development or have limited support, and there may be differences in API structure, inheritance, or behavior compared to Roblox. In particular, incomplete or unlinked features may not work correctly when called.

To confirm exact support and see available properties, methods, and events, be sure to read the API Reference page. This helps prevent confusion or unexpected errors due to differences from Roblox behavior.



Learn More

{% content-ref url="../../development/api-reference/" %}
[api-reference](../../development/api-reference/)
{% endcontent-ref %}



## Quick Guide: Transitioning from Roblox to OVERDARE

When migrating a project from Roblox to OVERDARE, it’s recommended to review the following items to ensure **compatibility**.

* Hierarchical transform inheritance (Weld not supported)
* 3D world coordinates use cm instead of Studs
* Default Anchored value is true
* Asset IDs use the format ovdrassetid://number
* Calling Destroy() sets variables to nil; use the isnil() function to check validity
* Check the event scope for PlayerAdded and CharacterAdded in LocalScripts

💡 **Tip**: Rather than directly porting Roblox behavior, it’s more reliable to **refactor** to fit OVERDARE Studio’s structure. This not only prevents unexpected behavior but also benefits long-term project maintenance and scalability.



## External IDE Integration Support

Unlike Roblox, OVERDARE always saves map files locally as well, and scripts are automatically generated as Lua files in a local folder. This setup allows you to edit scripts directly in external IDEs such as Visual Studio Code, and integrate various development tools to improve workflow efficiency and productivity.

<figure><img src="../../.gitbook/assets/Group 171.png" alt=""><figcaption></figcaption></figure>



## Asset Creation Guidelines

When importing assets, OVERDARE supports a more limited range of file formats compared to Roblox. This is to maintain Unreal Engine-level graphic quality while targeting markets with a high proportion of low-spec devices, such as Brazil. To provide a stable and consistent user experience across various device environments, we recommend that you follow the guidelines below when creating resources.



Learn More

{% content-ref url="../studio-manual/asset-and-resource-creation/asset-import.md" %}
[asset-import.md](../studio-manual/asset-and-resource-creation/asset-import.md)
{% endcontent-ref %}



## Useful Resources

### Character Animations

By using the animation packages registered in the **Asset Drawer**, you can easily implement character animations for various genres, including Obby, TPA, TPS, and Life, without creating them from scratch. These packages support a wide range of actions, from basic movement, jumping, and falling to combat and emotional expressions.



Learn More

{% content-ref url="../studio-manual/character/character-animation.md" %}
[character-animation.md](../studio-manual/character/character-animation.md)
{% endcontent-ref %}



## Getting Started

{% content-ref url="../studio-manual/get-started/studio-interface.md" %}
[studio-interface.md](../studio-manual/get-started/studio-interface.md)
{% endcontent-ref %}

{% content-ref url="../script-manual/get-started/script-overview.md" %}
[script-overview.md](../script-manual/get-started/script-overview.md)
{% endcontent-ref %}

{% content-ref url="../../overdare/get-started/install-app.md" %}
[install-app.md](../../overdare/get-started/install-app.md)
{% endcontent-ref %}



## Development Support

Join the [OVERDARE Creator Community Server](https://discord.com/invite/CbxxNTva98) on Discord to actively engage in game development, ask questions, share information, and participate in community activities!
