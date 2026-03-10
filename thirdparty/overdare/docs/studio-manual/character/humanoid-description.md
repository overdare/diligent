# Humanoid Description

## Overview

HumanoidDescription is a useful tool that allows game developers to bring their creative vision and game design intentions to life. By using this function, creators can alter a player’s avatar appearance to fit specific scenarios or themes within the game. This helps maintain a consistent style or atmosphere in the game, and enhance the overall player experience.

HumanoidDescription doesn’t just change the appearance of an avatar. It can also control various character behaviors, such as animations or size. For example, upon entering a specific region, a character might wear a particular outfit or trigger a specific animation. These functions are closely tied to the game’s storytelling and gameplay mechanics to offer players a more meaningful experience in the game.

## Attributes

| Attribute                     | Description                              |
| ----------------------------- | ---------------------------------------- |
| Head                          | Head MeshPart                            |
| Torso                         | Torso MeshPart                           |
| LeftArm                       | Left arm MeshPart                        |
| RightArm                      | Right arm MeshPart                       |
| LeftLeg                       | Left leg MeshPart                        |
| RightLeg                      | Right leg MeshPart                       |
| HeadColor                     | Head mesh color                          |
| TorsoColor                    | Torso mesh color                         |
| LeftArmColor                  | Left arm mesh color                      |
| RightArmColor                 | Right arm mesh color                     |
| LeftLegColor                  | Left leg mesh color                      |
| RightLegColor                 | Right leg mesh color                     |
| HeadTextureId                 | Head mesh texture                        |
| TorsoTextureId                | Torso mesh texture                       |
| LeftArmTextureId              | Left arm mesh texture                    |
| RightArmTextureId             | Right arm mesh texture                   |
| LeftLegTextureId              | Left leg mesh texture                    |
| RightLegTextureId             | Right leg mesh texture                   |
| IdleAnimantion                | Idle animation                           |
| WalkAnimantion                | Walking animation                        |
| RunAnimantion                 | Running animation                        |
| JumpAnimantion                | Jumping animation                        |
| FallAnimantion                | Freefall animation                       |
| LandedAnimation               | Landing animation                        |
| SwimmingIdleAnimation         | Idle swimming animation                  |
| SwimmingBreaststrokeAnimation | Swimming animation                       |
| ClimbingAnimantion            | Climbing animation                       |
| DieAnimation                  | Death animation                          |
| HeightScale                   | Character y-axis scale, character height |
| DepthScale                    | Character z-axis scale, character depth  |
| WidthScale                    | Character x-axis scale, character width  |

\\

## How to Use

HumanoidDescription can be created and applied through the level browser or script.

### Creating HumanoidDescription from the level browser

<figure><img src="../../../.gitbook/assets/image 9.png" alt=""><figcaption></figcaption></figure>

<figure><img src="../../../.gitbook/assets/image (16) (1).png" alt=""><figcaption></figcaption></figure>

### Creating and applying HumanoidDescription using a script

```lua
local function ApplyHumanoidDescription(character)
    local humanoidDesc = Instance.new("HumanoidDescription")
    
    -- BodyPart Mesh
    humanoidDesc.Head     = 8213300
    humanoidDesc.Torso    = 8214200
    humanoidDesc.LeftArm  = 8213200
    humanoidDesc.LeftLeg  = 8213400
    humanoidDesc.RightArm = 8213100
    humanoidDesc.RightLeg = 8214100
    
    -- BodyPart Texture    
    humanoidDesc.HeadTextureId     = 8211400
    humanoidDesc.TorsoTextureId    = 8212600
    humanoidDesc.LeftArmTextureId  = 8212400
    humanoidDesc.LeftLegTextureId  = 8211500
    humanoidDesc.RightArmTextureId = 8212500
    humanoidDesc.RightLegTextureId = 8212500
    
    -- BodyPart Color
    humanoidDesc.HeadColor     = Color3.fromRGB(255, 100, 100)
    humanoidDesc.TorsoColor    = Color3.fromRGB(0, 255, 100)
    humanoidDesc.LeftArmColor  = Color3.fromRGB(255, 0, 0)
    humanoidDesc.LeftLegColor  = Color3.fromRGB(0, 255, 0)
    humanoidDesc.RightArmColor = Color3.fromRGB(0, 0, 255)
    humanoidDesc.RightLegColor = Color3.fromRGB(100, 0, 100)
    
    -- Animations
    humanoidDesc.IdleAnimation   = "ovdrassetid://18558100"
    humanoidDesc.RunAnimation    = "ovdrassetid://18559300"
    humanoidDesc.WalkAnimation   = "ovdrassetid://18560100"
    humanoidDesc.JumpAnimation   = "ovdrassetid://18563500"
    humanoidDesc.FallAnimation   = "ovdrassetid://18563700"
    humanoidDesc.LandedAnimation = "ovdrassetid://18565100"
    
    --Scale
    humanoidDesc.HeightScale = 1.6
    humanoidDesc.DepthScale  = 1.4
    humanoidDesc.WidthScale  = 1.4
    
    humanoidDesc.Parent = character

    local humanoid = character:WaitForChild("Humanoid")
    humanoid:ApplyDescription(humanoidDesc, Enum.AssetTypeVerification.Default)
end
```

### Changing the Appearance

The player avatar that enters the UGC world will appear as it is set up in the app. However, certain game characteristics may require restrictions on the character’s clothing or accessories.

For example, in games like hide-and-seek, where the character must hide to avoid being seen, extravagant avatars may be at a disadvantage. In such cases, it may be necessary to standardize clothing for all players to ensure fair competition. Another example would be assigning players to teams and having them wear uniforms to indicate which team they belong to.

To meet such requirements, the creator can use HumanoidDescription to modify the player’s appearance. This function can help achieve a consistent avatar style that aligns with the game’s characteristics, which may improve both the fun and fairness of the game.

#### **Changing the MeshPart**

<figure><img src="../../../.gitbook/assets/image (17) (1).png" alt=""><figcaption></figcaption></figure>

<figure><img src="../../../.gitbook/assets/image (21) (1).png" alt=""><figcaption></figcaption></figure>

#### **Changing the MeshPart Texture and Color**

<figure><img src="../../../.gitbook/assets/Group 11 (1).png" alt=""><figcaption></figcaption></figure>

### Changing the Animation

At OVERDARE Studio, all characters currently use the same default animation, and all players move in the same way. However, in a UGC environment, it can be important to diversify animations based on the player’s status.

For example, if a player is attacked and must transform into a zombie, instead of simply changing the character’s appearance, an animation that makes the character walk like a zombie can be applied. This makes the game more immersive to provide a more realistic experience for players.

By using HumanoidDescription, the character’s default animations (such as idle, walking, running, jumping, landing, dying, etc.) can be easily switched and synchronized. This powerful tool allows for the customization of animations based on various in-game scenarios, enabling creators to enhance the game’s story and interactions.

{% embed url="https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FhRPi87oM9ttlk5nyu7L7%2Fuploads%2FhDiclS51wrYpJxxDaVur%2F2025-03-14%2021-40-25.mp4?alt=media&token=92520b7d-1b15-4396-8154-af84be508523" %}

#### **Regarding Animation Synchronization**

By default, movement-related animations such as idle, walking, and running are not synchronized in real time through the server. Instead, a player’s animation data is initialized and sent to all clients when the player logs into the game. After that, when the character moves or jumps, the client plays the corresponding animations based on the animation data received at the start.

As a result, even if a player’s character equips a weapon and their default movement animation changes, this update is not reflected on other clients. In other words, other players won’t see the change in that character’s movement animations.

<figure><img src="../../../.gitbook/assets/image (22) (1).png" alt=""><figcaption><p>Even though they are holding a weapon and the HandgunIdle animation is playing on their client, the other player sees the default animation instead of the HandgunIdle animation.</p></figcaption></figure>

To address this, an animation synchronization function is needed. However, creating such a function typically requires a complex script.

To resolve this issue, HumanoidDescription can be used to easily synchronize default animations without the need for complicated synchronization scripts. This allows for a consistent animation experience across the game while simplifying the creator’s workload.

{% embed url="https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FhRPi87oM9ttlk5nyu7L7%2Fuploads%2FGTxAvOVUqB5JDC3qKIsR%2F2025-03-14%2021-53-46.mp4?alt=media&token=d01ba13e-6696-47e8-a868-9ea3c5c72baf" %}
By implementing HumanoidDescription, the character’s animations can be synchronized without a complicated synchronization script.
{% endembed %}
