# World Template

## Overview

By using world templates that come with key features pre-included, you can easily create a game without writing additional scripts. For example, using the TPS template provides essential features like character control, TPS camera view, and gun systems, allowing you to test and develop immediately without the need for further implementation.

## How to Use

World templates are displayed in the **Start with Template** section on the first screen of OVERDARE Studio. By clicking on the desired template, you can duplicate it and create a new project.

<figure><img src="../../../.gitbook/assets/image (129).png" alt=""><figcaption></figcaption></figure>

## Template Type

<table><thead><tr><th width="158.4736328125">Template</th><th width="352.9473876953125">Description</th><th>Use</th></tr></thead><tbody><tr><td>Island</td><td>An island map where you can experience seasonal changes and basic terrain. You can explore various seasonal styles by following signs and learn about the asset store and object swapping | Tutorial, Basic Learning, Social Map</td><td>Tutorial, Basic Learning, Social Map</td></tr><tr><td>Lobby</td><td>A lobby with modules like shops and scoreboards. Can be used as the starting point of a game without additional implementation</td><td>Waiting Room, Game Hub, Community Space</td></tr><tr><td>TPS</td><td>A third-person shooting game template with weapon systems and module scripts for shooting, aiming, and camera control. Suitable for prototype creation</td><td>TPS Shooting Games, Combat-Based Games</td></tr><tr><td>Potion Factory</td><td>A complete potion factory background. Can be used for various genres like crafting and fantasy</td><td>Background Set, Crafting, Fantasy/Factory Simulation</td></tr><tr><td>Jungle</td><td>A survival map set in a dense forest, featuring custom props and animation for exploration, hunting, and resource gathering.</td><td>Survival, Exploration, Hunting</td></tr><tr><td>Obby</td><td>An Obby map that contains various dynamic obstacles such as moving pillars, rotating discs, and swinging pendulums. You can adjust difficulty and achieve a specific style by freely changing speed and placement.</td><td>Obby, race, obstacle, parkour, module</td></tr></tbody></table>

## Key Features Included in the Template Island

### Island

<table><thead><tr><th width="463.24560546875">Feature</th><th width="279.87725830078125">Related Script</th></tr></thead><tbody><tr><td>Chair</td><td>ChairManager<br>SittingSystem</td></tr><tr><td>Campfire</td><td>CampfireTrigger</td></tr><tr><td>Fishing</td><td>FishingAreaTrigger<br>FishingSystem</td></tr><tr><td>Time Change</td><td>TimeSetSwitch<br>TimeFlowSwitchTrigger<br>TimeResetTrigger</td></tr></tbody></table>

### Lobby

<table><thead><tr><th width="463.24560546875">Feature</th><th width="279.87725830078125">Related Script</th></tr></thead><tbody><tr><td>Climbing</td><td>ClimbDisabler</td></tr><tr><td>Chair</td><td>ChairManager<br>SittingSystem</td></tr><tr><td>Scoreboard</td><td>ScorePart<br>Scoreboard<br>ScoreboardUI</td></tr><tr><td>Shop UI</td><td>ShopOpenTrigger<br>ShopUI<br>Shop</td></tr></tbody></table>

### TPS

<table><thead><tr><th width="463.24560546875">Feature</th><th width="279.87725830078125">Related Script</th></tr></thead><tbody><tr><td>Sets UI position, size, and image settings for fire/reload buttons</td><td>Config</td></tr><tr><td>Third-person camera setup</td><td>OSSy_TPS_Camera</td></tr><tr><td>A combat network event handler that manages bullet replication, damage processing, effects, and broadcasts related events to all clients</td><td>BulletReplicate</td></tr><tr><td>Locally controls the TPS combat system, including weapon equip, firing, reloading, aiming, recoil, and GUI updates</td><td>OSSy_Client</td></tr><tr><td>An event handler that receives combat-related client events such as shooting, damage, and effects from other locals, and synchronizes bullet creation and visual/audio effects locally</td><td>OSSy_EventHandler</td></tr><tr><td>Sets weapon data setup, including fire rate, recoil, ammo count, and bullet spread</td><td>WeaponData</td></tr><tr><td>Animation setup modules</td><td>BasicAnimantionData<br>AnimantionData<br>MotionSyncModule</td></tr><tr><td>Animation synchronization</td><td>LocomotionSync<br>OSSy_MotionSync</td></tr><tr><td>Animation controller</td><td>CharacterAnimationManager</td></tr><tr><td>Weapon respawn</td><td>Spawner</td></tr></tbody></table>

### Potion Factory

<table><thead><tr><th width="463.24560546875">Feature</th><th width="279.87725830078125">Related Script</th></tr></thead><tbody><tr><td>Climbing</td><td>ClimbDisabler</td></tr></tbody></table>

### Jungle

This map does not include script feature.

### Obby

<table><thead><tr><th width="463.24560546875">Feature</th><th width="279.87725830078125">Related Script</th></tr></thead><tbody><tr><td>Processes initialization when player enters, sets respawn time, and specifies checkpoint location</td><td>GameSetting</td></tr><tr><td>Processes Timer and Goal UI</td><td>HUDScript</td></tr><tr><td>Measures elapsed game time</td><td>Stopwatch</td></tr><tr><td>Kills the character touched by the Part</td><td>KillPart</td></tr><tr><td>Sets the checkpoint information for the character touched by the Part</td><td>Checkpoint</td></tr><tr><td>Processes the start and end of run</td><td>StartLine / GoalLine</td></tr><tr><td>Processes Part movement</td><td>MovePart</td></tr><tr><td>Processes Part rotation</td><td>SpinPart / RotaryHammer / SwingPart</td></tr><tr><td>Applies a knockback effect that knocks back the character touched by the Part</td><td>ImpactPart</td></tr><tr><td>Processes obstacles that fall sequentially from above</td><td>FallingBalls</td></tr><tr><td>Disappears when the Part touches the character and then respawns after a certain time</td><td>DisappearPart</td></tr></tbody></table>
