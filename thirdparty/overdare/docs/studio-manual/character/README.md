# Character

## **Overview** <a href="#overview" id="overview"></a>

OVERDARE provides an avatar system based on **ODA (OVERDARE Deformable Avatar)**. Creators can use ODA to create games without implementing separate character systems. Using **Cage Mesh Deformer** technology, OVERDARE allows the creation and application of clothing and accessories compatible with various body parts.



## **Character Types** <a href="#character-types" id="character-types"></a>

OVERDARE UGC has two main character types:



* **Default Character**: An ODA-based character created using RigBuilder or imported from external sources.
* **Player Character**: An avatar character that the user can customize with clothing and accessories on the OVERDARE platform and control.



Both characters are ODA-based, with the distinction being whether the character was created by the player on the OVERDARE platform or by the creator within the game. Players can enjoy adventures as their avatar in the UGC world.

Creators can create NPCs for their game or replace player characters with custom ones based on the game’s concept and features.



## **Character Model Structure** <a href="#character-model-structure" id="character-model-structure"></a>

The OVERDARE character model consists of the following structures:

* **Model**: The highest-level object containing the entire character.
* **Humanoid**: Manages the character’s actions and states.
* **HumanoidRootPart**: The RootPart serving as the character’s center.
* **6 MeshParts**: Head, Torso, RightArm, LeftArm, RightLeg, LeftLeg.
* **Skeleton**: Skeletal structure composed of 22 bones.



## **Character** Parts and **Skeleton Structure** <a href="#character-parts-and-skeleton-structure" id="character-parts-and-skeleton-structure"></a>

OVERDARE avatars are based on 6 BodyParts (head, torso, both arms, both legs) and a skeleton structure.

* **6 MeshParts**: The MeshParts are easy to assemble like building blocks, allowing the replacement of body parts without complex rigging in OVERDARE Studio.
* **Skeletal Mesh Conversion**: When the game is launched, the 6 meshes are merged into one and converted into a skeletal mesh with 22 bones.
  * This allows for easy assembly of character appearances, similar to building with LEGO blocks, while also enabling smooth and dynamic animations.



The OVERDARE Avatar Bone Structure is as follows:

<figure><img src="../../../.gitbook/assets/image2024-12-20_15-50-27.png" alt=""><figcaption></figcaption></figure>

| No | Name          | Location                               | Attachments |
| -- | ------------- | -------------------------------------- | ----------- |
| 1  | Root          | Center of the character (ground level) |             |
| 2  | LowerTorsor   | Waist                                  |             |
| 3  | UpperTorsor01 | Lower abdomen                          |             |
| 4  | UpperTorsor02 | Upper abdomen                          |             |
| 5  | Neck          | Neck                                   |             |
| 6  | Head          | Head                                   |             |
| 7  | LeftClavicle  | Left collarbone                        |             |
| 8  | LeftUpperArm  | Left upper arm                         |             |
| 9  | LeftLowerArm  | Left lower arm                         |             |
| 10 | LeftHand      | Left hand                              |             |
| 11 | LeftItem      | Left equipment position                |             |
| 12 | RightClavicle | Right collarbone                       |             |
| 13 | RightUpperArm | Right upper arm                        |             |
| 14 | RightLowerArm | Right lower arm                        |             |
| 15 | RightHand     | Right hand                             |             |
| 16 | RightItem     | Right equipment position               |             |
| 17 | LeftUpperLeg  | Left thigh                             |             |
| 18 | LeftLowerLeg  | Left calf                              |             |
| 19 | LeftFoot      | Left foot                              |             |
| 20 | RightUpperLeg | Right thigh                            |             |
| 21 | RightLowerLeg | Right calf                             |             |
| 22 | RightFoot     | Right foot                             |             |



## **Humanoid System** <a href="#humanoid-system" id="humanoid-system"></a>

Humanoid is the core class that defines the character’s behavior and state.



### **Properties** <a href="#properties" id="properties"></a>

| Property            | Description                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| DisplayDistanceType |                                                                                                |
| Health              | The character’s current health                                                                 |
| JumpPower           | The character’s jump power. When calculated with gravity, this determines maximum jump height. |
| MaxHealth           | The character’s maximum health                                                                 |
| RootPart            | The character’s base Part (HumanoidRootPart)                                                   |
| WalkSpeed           | The character’s walking speed                                                                  |



### **Humanoid State** <a href="#humanoid-state" id="humanoid-state"></a>

Humanoid supports multiple states (HumanoidStateType), each triggering a default animation. For example, “Jumping” is activated when jumping, and “FreeFall” is activated when falling.

You can use scripts to forcibly change states or restrict them from changing into a specific state.



### **Key Humanoid States**

| No | State    | Description                                          |
| -- | -------- | ---------------------------------------------------- |
| 1  | Running  | Default state; allows movement or jumping.           |
| 2  | Jumping  | The character is ascending after a jump.             |
| 3  | Freefall | The character is descending in the air.              |
| 4  | Landed   | The character has landed on the ground from the air. |
| 5  | Climbing | The character is climbing an object.                 |
| 6  | Swimming | The character is swimming.                           |
| 8  | Ragdoll  | Ragdoll is activated.                                |
| 9  | Dead     | The character has died after health reaches 0.       |
| 10 | Physics  | Physics is activated.                                |



#### **Humanoid State Restrictions**

You can use the `Humanoid:SetStateEnabled` function to restrict state transitions.\
For example, even if a character gets near a Part that can be climbed, you can prevent that state transition with the code below:

{% embed url="https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FhRPi87oM9ttlk5nyu7L7%2Fuploads%2FPyWJqwo43mkZOAERasyv%2F2025-07-03%2014-58-35.mp4?alt=media&token=0b071649-71ef-4c36-a318-fee034737cd5" %}
Climbing state
{% endembed %}

```lua
local Character = script.Parent
local Humanoid = Character.Humanoid

Humanoid:SetStateEnabled(Enum.HumanoidStateType.Climbing, false)
```

{% embed url="https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FhRPi87oM9ttlk5nyu7L7%2Fuploads%2FjuG0oxouwcPoxkcXLQn1%2F2025-07-03%2014-59-13.mp4?alt=media&token=c3f5f041-47b2-4919-a130-45137a2db0c7" %}
When the transition to the Climbing state is prevented
{% endembed %}



When a character comes into contact with a Part or MeshPart that has CanClimb enabled, they will automatically enter the Climbing state.

<div><figure><img src="../../../.gitbook/assets/image (151).png" alt=""><figcaption></figcaption></figure> <figure><img src="../../../.gitbook/assets/image (152).png" alt=""><figcaption></figcaption></figure></div>



#### **Humanoid State Transitions**

By default, Humanoid States transition automatically based on player input or Humanoid properties.\
For example, when `Health` reaches 0, the state changes to Dead. When the jump button is pressed, the state transitions as follows: Jumping → Freefall → Landed → Running.



#### **Ragdoll State**

The Ragdoll state makes the character appear limp like a ragdoll. In this state, animations and player input are disabled, and the character responds only to physical forces based on the skeleton structure.

The Ragdoll state does not transition automatically and must be manually activated using the `Humanoid:ChangeState` function:

```lua
local Character = script.Parent
local Humanoid = Character.Humanoid

Humanoid:ChangeState(Enum.HumanoidStateType.Ragdoll)
```

{% embed url="https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FhRPi87oM9ttlk5nyu7L7%2Fuploads%2F7MLoVVhKEa2pYtSmDIBu%2F2025-02-18%2017-43-47.mp4?alt=media&token=2c730a33-1a14-4248-b36e-6a3830c4b2da" %}



To get back to the original state from the Ragdoll state, you need to force a state change, as follows:

```lua
local Character = script.Parent
local Humanoid = Character.Humanoid

Humanoid:ChangeState(Enum.HumanoidStateType.Ragdoll)
wait(3)
Humanoid:ChangeState(Enum.HumanoidStateType.Running)
```



#### Physics State

In the Physics state, a character’s movement is governed solely by the physics engine. In this state, previous animations and player inputs do not work, and the character responds exclusively to forces applied via physics instances such as LinearVelocity and VectorForce.&#x20;

The Physics state does not transition automatically and must be manually enabled using the `Humanoid:ChangeState` function:

```lua
local Character = script.Parent
local Humanoid = Character.Humanoid

Humanoid:ChangeState(Enum.HumanoidStateType.Physics)
```



## **Attachment** <a href="#attachment" id="attachment"></a>

Attachments matched to each bone allow for features such as positioning effects, attaching accessories, and applying physical constraints.\
Attachments operate based on the dynamic movement of bones, enabling creators to easily place items that interact with the character model.



## **Character Animation** <a href="#character-animation" id="character-animation"></a>

{% content-ref url="character-animation.md" %}
[character-animation.md](character-animation.md)
{% endcontent-ref %}
