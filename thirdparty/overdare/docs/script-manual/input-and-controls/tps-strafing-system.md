# TPS Strafing System

## Overview

The TPS Strafing System is a movement method commonly used in third-person shooter (TPS) games. In this system, the character moves relative to the camera’s direction. The torso stays aligned with the aiming point, while the lower body moves according to the player’s movement direction. This allows the upper and lower body animations to play independently, enabling more flexible aiming and movement control.

## How to Use

### Activate Use Strafing Animations

After selecting the players in the Level Browser, activate **Use Strafing Animations**.

<figure><img src="../../../.gitbook/assets/image (127).png" alt=""><figcaption></figcaption></figure>

When this option is deactivated, the **single movement animation** will play.

When this option is enabled, **animations will play in eight directions** (up, down, left, right, and diagonally) based on the character’s movement direction. This allows the character to move naturally in various directions, such as **strafing, reversing, and diagonal movement**.

<figure><img src="../../../.gitbook/assets/Strafing01.gif" alt=""><figcaption><p>Deactivate Use Strafing Animations</p></figcaption></figure>

<figure><img src="../../../.gitbook/assets/Strafing02.gif" alt=""><figcaption><p>Activate Use Strafing Animations</p></figcaption></figure>

When only the Use Strafing Animations option is enabled, the difference may not be visually noticeable. This feature must be used in conjunction with the following settings to fully experience its effects.

### Set the character’s rotation direction based on the camera’s direction

Set the **RotationType** of UserGameSettings to **CameraRelative** so that the character rotates according to the direction of the camera.

(To restore existing settings, set it to Enum.RotationType.MovementRelative.)

In StarterCharacterScripts, write the following code for LocalScript:

<pre class="language-lua"><code class="lang-lua">local Players = game:GetService("Players")
local LocalPlayer = Players.LocalPlayer

repeat wait() until LocalPlayer.Character
local Character = LocalPlayer.Character
local Humanoid = Character:WaitForChild("Humanoid")

local UserGameSettings = UserSettings().GameSettings
<strong>UserGameSettings.RotationType = Enum.RotationType.CameraRelative
</strong></code></pre>

When the character’s rotation is set to follow the camera (CameraRelative) and the Use Strafing Animations option is enabled, the character will always face the direction of the camera. This setup allows the torso animation to align with the camera (aiming direction), while the lower body animations play independently based on the movement direction.

<figure><img src="../../../.gitbook/assets/Strafing03.gif" alt=""><figcaption></figcaption></figure>

If RotationType is set to CameraRelative, the character’s rotation speed based on the camera direction can be controlled using the **CharacterTurnRate** value.\
(The default value is -1, which means the character will rotate instantly.)

```lua
UserGameSettings.CharacterTurnRate = 200
```

### Apply Camera Offset

The camera’s relative position can be adjusted using the **CameraOffset** attribute. In TPS games, the character is typically positioned slightly off-center to prevent the character from overlapping with the aiming point on the screen.

In StarterCharacterScripts, write the following code for LocalScript:

```lua
local Workspace = game:GetService("Workspace")
local Camera = Workspace.CurrentCamera

Camera.CameraOffset = Vector3.new(90, 90, -120)
```

<figure><img src="../../../.gitbook/assets/image (128).png" alt=""><figcaption></figcaption></figure>

### Changing the Torso Animation

The character’s torso and lower body animations can be played separately, regardless of the Use Strafing Animations option. If the **UpperBodyAnimation** attribute is set to “True” in the animation track, the animation will apply only to the torso.

In StarterCharacterScripts, write the following code for LocalScript:

```lua
local Animation = Instance.new("Animation")
Animation.AnimationId = "BasicHandgunIdleAnimation"

local Animator = Humanoid:FindFirstChild("Animator")
local AnimationTrack = Animator:LoadAnimation(Animation)
AnimationTrack.UpperBodyAnimation = true
AnimationTrack.Priority = Enum.AnimationPriority.Movement 

AnimationTrack.Looped = true
AnimationTrack:Play()
```

When Use Strafing Animations and UpperBodyAnimation are used together, the torso follows the aiming direction while the lower body moves according to the movement direction, resulting in more natural and dynamic character animations.

<figure><img src="../../../.gitbook/assets/Strafing04.gif" alt=""><figcaption></figcaption></figure>

## Usage Examples

* RotationType settings according to whether a gun is equipped
  * When no gun is equipped, it is set to MovementRelative, and the default movement animations are played
  * When a gun is equipped, it switches to CameraRelative to lock the character’s vision
* RotationType settings according to whether or not the character is aiming when a projectile weapon is equipped
  * When the character is not aiming, it is set to MovementRelative, and the default movement animations are played
  * When the character is aiming, it switches to CameraRelative to lock the character’s vision
* CameraOffset is processed differently depending on the weapon type

## Strafing Animation Assets

Search for the **Asset Name** in the **Asset Drawer** to use animation packages.\
(Using the **Asset Id** allows direct use in scripts without placing it in the Level Browser.)

Learn How to Play Animations

{% content-ref url="../../studio-manual/character/character-animation.md" %}
[character-animation.md](../../studio-manual/character/character-animation.md)
{% endcontent-ref %}

{% tabs %}
{% tab title="Basic" %}
<table><thead><tr><th width="215">Animation</th><th>Animation Id</th></tr></thead><tbody><tr><td><img src="../../../.gitbook/assets/Strafing_Basic_Walk1.gif" alt=""></td><td><p>ovdrassetid://18426300</p><ul><li><p>Asset Name : BasicWalkAnimations</p><ul><li><p>BasicWalkForwardAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Basic_Walk2.gif" alt=""></td><td><p>ovdrassetid://18429100</p><ul><li><p>Asset Name : BasicWalkAnimations</p><ul><li><p>BasicWalkLeftAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Basic_Walk3.gif" alt=""></td><td><p>ovdrassetid://18427600</p><ul><li><p>Asset Name : BasicWalkAnimations</p><ul><li><p>BasicWalkForwardLeftAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Basic_Walk4.gif" alt=""></td><td><p>ovdrassetid://18428100</p><ul><li><p>Asset Name : BasicWalkAnimations</p><ul><li><p>BasicWalkForwardRightAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Basic_Walk5.gif" alt=""></td><td><p>ovdrassetid://18430100</p><ul><li><p>Asset Name : BasicWalkAnimations</p><ul><li><p>BasicWalkRightAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Basic_Walk6.gif" alt=""></td><td><p>ovdrassetid://18427200</p><ul><li><p>Asset Name : BasicWalkAnimations</p><ul><li><p>BasicWalkBackLeftAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Basic_Walk7.gif" alt=""></td><td><p>ovdrassetid://18427400</p><ul><li><p>Asset Name : BasicWalkAnimations</p><ul><li><p>BasicWalkBackRightAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Basic_Walk8.gif" alt=""></td><td><p>BasicWalkBackAnimation</p><p>or</p><p>ovdrassetid://18426100</p><ul><li><p>Asset Name : BasicWalkAnimations</p><ul><li><p>BasicWalkBackAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/01BasicRunForwardAnimation.gif" alt=""></td><td><p>ovdrassetid://18400100</p><ul><li><p>Asset Name : BasicAnimations</p><ul><li><p>BasicRunForwardAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/02BasicRunLeftAnimation.gif" alt=""></td><td><p>ovdrassetid://18402100</p><ul><li><p>Asset Name : BasicAnimations</p><ul><li><p>BasicRunLeftAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/03BasicRunForwardLeftAnimation.gif" alt=""></td><td><p>ovdrassetid://18401200</p><ul><li><p>Asset Name : BasicAnimations</p><ul><li><p>BasicRunForwardLeftAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/04BasicRunForwardRightAnimation.gif" alt=""></td><td><p>ovdrassetid://18403200</p><ul><li><p>Asset Name : BasicAnimations</p><ul><li><p>BasicRunForwardRightAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/05BasicRunRightAnimation.gif" alt=""></td><td><p>ovdrassetid://18406100</p><ul><li><p>Asset Name : BasicAnimations</p><ul><li><p>BasicRunRightAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/06BasicRunBackLeftAnimation.gif" alt=""></td><td><p>ovdrassetid://18408100</p><ul><li><p>Asset Name : BasicAnimations</p><ul><li><p>BasicRunBackLeftAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/07BasicRunBackRightAnimation.gif" alt=""></td><td><p>ovdrassetid://18409100</p><ul><li><p>Asset Name : BasicAnimations</p><ul><li><p>BasicRunBackRightAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/08BasicRunBackAnimation.gif" alt=""></td><td><p>ovdrassetid://18406200</p><ul><li><p>Asset Name : BasicAnimations</p><ul><li><p>BasicRunBackAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr></tbody></table>
{% endtab %}

{% tab title="Melee" %}
<table><thead><tr><th width="215">Animation</th><th>Animation Id</th></tr></thead><tbody><tr><td><img src="../../../.gitbook/assets/Strafing_Melee_Walk1.gif" alt=""></td><td><p>ovdrassetid://18497100</p><ul><li><p>Asset Name : MeleeMovingAnimations</p><ul><li><p>MeleeWalkFowardAnimation</p><ul><li>Duration: 1.13 </li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Melee_Walk2.gif" alt=""></td><td><p>ovdrassetid://18491200</p><ul><li><p>Asset Name : MeleeMovingAnimations</p><ul><li><p>MeleeWalkLeftFowardAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Melee_Walk3.gif" alt=""></td><td><p>ovdrassetid://18496400</p><ul><li><p>Asset Name : MeleeMovingAnimations</p><ul><li><p>MeleeWalkRightFowardAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Melee_Walk4.gif" alt=""></td><td><p>ovdrassetid://18500100</p><ul><li><p>Asset Name : MeleeMovingAnimations</p><ul><li><p>MeleeWalkLeftAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Melee_Walk5.gif" alt=""></td><td><p>ovdrassetid://18493100</p><ul><li><p>Asset Name : MeleeMovingAnimations</p><ul><li><p>MeleeWalkRightAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Melee_Walk6.gif" alt=""></td><td><p>ovdrassetid://18494200</p><ul><li><p>Asset Name : MeleeMovingAnimations</p><ul><li><p>MeleeWalkBackAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Melee_Walk7.gif" alt=""></td><td><p>ovdrassetid://18489300</p><ul><li><p>Asset Name : MeleeMovingAnimations</p><ul><li><p>MeleeWalkLeftBackAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Melee_Walk8.gif" alt=""></td><td><p>ovdrassetid://18487100</p><ul><li><p>Asset Name : MeleeMovingAnimations</p><ul><li><p>MeleeWalkRightBackAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Melee_Run1.gif" alt=""></td><td><p>ovdrassetid://18495100</p><ul><li><p>Asset Name : MeleeMovingAnimations</p><ul><li><p>MeleeRunFowardAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Melee_Run2.gif" alt=""></td><td><p>ovdrassetid://18489400</p><ul><li><p>Asset Name : MeleeMovingAnimations</p><ul><li><p>MeleeRunLeftFowardAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Melee_Run3.gif" alt=""></td><td><p>ovdrassetid://18496100</p><ul><li><p>Asset Name : MeleeMovingAnimations</p><ul><li><p>MeleeRunRightFowardAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Melee_Run4.gif" alt=""></td><td><p>ovdrassetid://18487300</p><ul><li><p>Asset Name : MeleeMovingAnimations</p><ul><li><p>MeleeRunLeftAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Melee_Run5.gif" alt=""></td><td><p>ovdrassetid://18490100</p><ul><li><p>Asset Name : MeleeMovingAnimations</p><ul><li><p>MeleeRunRightAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Melee_Run6.gif" alt=""></td><td><p>ovdrassetid://18486100</p><ul><li><p>Asset Name : MeleeMovingAnimations</p><ul><li><p>MeleeRunBackAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Melee_Run7.gif" alt=""></td><td><p>ovdrassetid://18486300</p><ul><li><p>Asset Name : MeleeMovingAnimations</p><ul><li><p>MeleeRunLeftBackAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Melee_Run8.gif" alt=""></td><td><p>ovdrassetid://18490200</p><ul><li><p>Asset Name : MeleeMovingAnimations</p><ul><li><p>MeleeRunRightBackAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr></tbody></table>
{% endtab %}

{% tab title="Handgun" %}
<table><thead><tr><th width="215">Animation</th><th>Animation Id</th></tr></thead><tbody><tr><td><img src="../../../.gitbook/assets/Strafing_Handgun_Walk1.gif" alt=""></td><td><p>ovdrassetid://18580200</p><ul><li><p>Asset Name : HandgunMovingAnimations</p><ul><li><p>HandgunWalkFowardAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Handgun_Walk2.gif" alt=""></td><td><p>ovdrassetid://18585500</p><ul><li><p>Asset Name : HandgunMovingAnimations</p><ul><li><p>HandgunWalkLeftFowardAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Handgun_Walk3.gif" alt=""></td><td><p>ovdrassetid://18587200</p><ul><li><p>Asset Name : HandgunMovingAnimations</p><ul><li><p>HandgunWalkRightFowardAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Handgun_Walk4.gif" alt=""></td><td><p>ovdrassetid://18585300</p><ul><li><p>Asset Name : HandgunMovingAnimations</p><ul><li><p>HandgunWalkLeftAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Handgun_Walk5.gif" alt=""></td><td><p>ovdrassetid://18582100</p><ul><li><p>Asset Name : HandgunMovingAnimations</p><ul><li><p>HandgunWalkRightAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Handgun_Walk6.gif" alt=""></td><td><p>ovdrassetid://18574100</p><ul><li><p>Asset Name : HandgunMovingAnimations</p><ul><li><p>HandgunWalkBackAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Handgun_Walk7.gif" alt=""></td><td><p>ovdrassetid://18583100</p><ul><li><p>Asset Name : HandgunMovingAnimations</p><ul><li><p>HandgunWalkLeftBackAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Handgun_Walk8.gif" alt=""></td><td><p>ovdrassetid://18589100</p><ul><li><p>Asset Name : HandgunMovingAnimations</p><ul><li><p>HandgunWalkRightBackAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Handgun_Run1.gif" alt=""></td><td><p>ovdrassetid://18586100</p><ul><li><p>Asset Name : HandgunMovingAnimations</p><ul><li><p>HandgunRunFowardAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Handgun_Run2.gif" alt=""></td><td><p>ovdrassetid://18585100</p><ul><li><p>Asset Name : HandgunMovingAnimations</p><ul><li><p>HandgunRunLeftFowardAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Handgun_Run3.gif" alt=""></td><td><p>ovdrassetid://18580100</p><ul><li><p>Asset Name : HandgunMovingAnimations</p><ul><li><p>HandgunRunRightFowardAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Handgun_Run4.gif" alt=""></td><td><p>ovdrassetid://18581100</p><ul><li><p>Asset Name : HandgunMovingAnimations</p><ul><li><p>HandgunRunLeftAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Handgun_Run5.gif" alt=""></td><td><p>ovdrassetid://18577100</p><ul><li><p>Asset Name : HandgunMovingAnimations</p><ul><li><p>HandgunRunRightAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Handgun_Run6.gif" alt=""></td><td><p>ovdrassetid://18578100</p><ul><li><p>Asset Name : HandgunMovingAnimations</p><ul><li><p>HandgunRunBackAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Handgun_Run7.gif" alt=""></td><td><p>ovdrassetid://18576100</p><ul><li><p>Asset Name : HandgunMovingAnimations</p><ul><li><p>HandgunRunLeftBackAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Handgun_Run8.gif" alt=""></td><td><p>ovdrassetid://18588100</p><ul><li><p>Asset Name : HandgunMovingAnimations</p><ul><li><p>HandgunRunRightBackAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr></tbody></table>
{% endtab %}

{% tab title="Rifle" %}
<table><thead><tr><th width="215">Animation</th><th>Animation Id</th></tr></thead><tbody><tr><td><img src="../../../.gitbook/assets/Strafing_Rifle_Walk1.gif" alt=""></td><td><p>ovdrassetid://18618100</p><ul><li><p>Asset Name : RifleRunFowardAnimation</p><ul><li><p>RifleWalkFowardAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Rifle_Walk2.gif" alt=""></td><td><p>ovdrassetid://18619100</p><ul><li><p>Asset Name : RifleRunFowardAnimation</p><ul><li><p>RifleWalkLeftFowardAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Rifle_Walk3.gif" alt=""></td><td><p>ovdrassetid://18632200</p><ul><li><p>Asset Name : RifleRunFowardAnimation</p><ul><li><p>RifleWalkRightFowardAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Rifle_Walk4.gif" alt=""></td><td><p>ovdrassetid://18626100</p><ul><li><p>Asset Name : RifleRunFowardAnimation</p><ul><li><p>RifleWalkLeftAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Rifle_Walk5.gif" alt=""></td><td><p>ovdrassetid://18635600</p><ul><li><p>Asset Name : RifleRunFowardAnimation</p><ul><li><p>RifleWalkRightAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Rifle_Walk6.gif" alt=""></td><td><p>ovdrassetid://18621100</p><ul><li><p>Asset Name : RifleRunFowardAnimation</p><ul><li><p>RifleWalkBackAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Rifle_Walk7.gif" alt=""></td><td><p>ovdrassetid://18624100</p><ul><li><p>Asset Name : RifleRunFowardAnimation</p><ul><li><p>RifleWalkLeftBackAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Rifle_Walk8.gif" alt=""></td><td><p>ovdrassetid://18628800</p><ul><li><p>Asset Name : RifleRunFowardAnimation</p><ul><li><p>RifleWalkRightBackAnimation</p><ul><li>Duration: 1.13</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Rifle_Run1.gif" alt=""></td><td><p>ovdrassetid://18631100</p><ul><li><p>Asset Name : RifleRunFowardAnimation</p><ul><li><p>RifleRunFowardAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Rifle_Run2.gif" alt=""></td><td><p>ovdrassetid://18637100</p><ul><li><p>Asset Name : RifleRunFowardAnimation</p><ul><li><p>RifleRunLeftFowardAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Rifle_Run3.gif" alt=""></td><td><p>ovdrassetid://18619200</p><ul><li><p>Asset Name : RifleRunFowardAnimation</p><ul><li><p>RifleRunRightFowardAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Rifle_Run4.gif" alt=""></td><td><p>ovdrassetid://18638100</p><ul><li><p>Asset Name : RifleRunFowardAnimation</p><ul><li><p>RifleRunLeftAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Rifle_Run5.gif" alt=""></td><td><p>ovdrassetid://18629600</p><ul><li><p>Asset Name : RifleRunFowardAnimation</p><ul><li><p>RifleRunRightAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Rifle_Run6.gif" alt=""></td><td><p>ovdrassetid://18622100</p><ul><li><p>Asset Name : RifleRunFowardAnimation</p><ul><li><p>RifleRunBackAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Rifle_Run7.gif" alt=""></td><td><p>ovdrassetid://18633100</p><ul><li><p>Asset Name : RifleRunFowardAnimation</p><ul><li><p>RifleRunLeftBackAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr><tr><td><img src="../../../.gitbook/assets/Strafing_Rifle_Run8.gif" alt=""></td><td><p>ovdrassetid://18627200</p><ul><li><p>Asset Name : RifleRunFowardAnimation</p><ul><li><p>RifleRunRightBackAnimation</p><ul><li>Duration: 0.66</li></ul></li></ul></li></ul></td></tr></tbody></table>
{% endtab %}
{% endtabs %}
