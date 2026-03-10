# Sound

## Overview <a href="#overview" id="overview"></a>

The Sound object is a core element for playing audio and adding sound effects in your game. You can attach it to a World, Part, UI, and more to implement various audio experiences such as background music, sound effects, and voice. This helps increase immersion and enrich interaction with the player.

## How to Use <a href="#how-to-use" id="how-to-use"></a>

### Setting Sound Id <a href="#setting-sound-id" id="setting-sound-id"></a>

To play a sound, place a Sound object and set the **SoundId** in the properties window.

<figure><img src="../../../.gitbook/assets/image (23).png" alt=""><figcaption></figcaption></figure>

You can copy the Sound Id by right-clicking an audio asset in the Asset Manager and clicking **Copy Asset ID to Clipboard**. Set the copied Asset ID in the format **ovdrassetid://number**.

<figure><img src="../../../.gitbook/assets/image (21).png" alt=""><figcaption></figcaption></figure>

### Sound Loading <a href="#sound-loading" id="sound-loading"></a>

When you set the Sound Id, the sound asset is loaded on the server. You can check the load state with the **IsLoaded** property.

#### Load-related behavior

When the asset is not loaded:

- Time Position settings are ignored
- Other properties such as Start Time Position, Volume, and Playback Region are applied normally

When the asset has finished loading:

- Time Position is automatically reset to 0
- The Loaded event fires
- The IsLoaded property becomes true

### Preview <a href="#preview" id="preview"></a>

When the Sound Id is set, you can click the Preview button to hear the sound.

<figure><img src="../../../.gitbook/assets/image (116).png" alt=""><figcaption></figcaption></figure>

### Property Summary <a href="#property-summary" id="property-summary"></a>

<table><thead><tr><th width="247">Property</th><th>Description</th></tr></thead><tbody><tr><td>Playing</td><td>Whether the sound is playing</td></tr><tr><td>Looped</td><td>Whether the sound loops</td></tr><tr><td>Volume</td><td>Volume (0–10, default 0.5)</td></tr><tr><td>Playback Regions Enabled</td><td>Whether to use PlaybackRegion and LoopRegion. When set to true, Start Time Position is ignored.</td></tr><tr><td>Playback Speed</td><td>Playback speed (1.0 is normal)</td></tr><tr><td>Start Time Position</td><td>Position in seconds where playback starts when Play() is called. Ignored when Playback Regions Enabled is true.</td></tr><tr><td>Time Position</td><td>Current playback position in seconds</td></tr><tr><td>Sound Id</td><td>Asset Id of the sound to play (format: ovdrassetid://number)</td></tr><tr><td>Loop Region</td><td>Section to use for looped playback (e.g. 5–10 seconds). Works when Looped = true and Playback Regions Enabled = true.</td></tr><tr><td>Playback Region</td><td>Playback range (e.g. 3–8 seconds). Works when Playback Regions Enabled = true.</td></tr><tr><td>Play on Remove</td><td>Whether to play automatically when the Sound object is removed</td></tr><tr><td>Sound Group</td><td>The sound group this sound belongs to</td></tr></tbody></table>

### Playback Range Control <a href="#playback-range-control" id="playback-range-control"></a>

Sound can use PlaybackRegion and LoopRegion to play or loop only a specific part of the sound. This lets you use only a portion of a long file or separate an intro from the loop section.

#### Basic rules

Playback range behaves differently depending on the **PlaybackRegionsEnabled** setting:

**When PlaybackRegionsEnabled = true:**

- PlaybackRegion and LoopRegion control the playback range
- StartTimePosition is ignored entirely
- You can precisely play only a specific part of the sound

**When PlaybackRegionsEnabled = false:**

- Only StartTimePosition affects where playback starts
- PlaybackRegion and LoopRegion are ignored
- The sound always plays to TimeLength

#### Quick reference table

| PlaybackRegionsEnabled | Looped | First play start   | Loop start                   | End                          |
| ---------------------- | ------ | ------------------ | ---------------------------- | ---------------------------- |
| true                   | true   | PlaybackRegion.Min | LoopRegion or PlaybackRegion | LoopRegion or PlaybackRegion |
| true                   | false  | PlaybackRegion.Min | -                            | PlaybackRegion.Max           |
| false                  | true   | StartTimePosition  | 0                            | TimeLength                   |
| false                  | false  | StartTimePosition  | -                            | TimeLength                   |

#### Enabling PlaybackRegionsEnabled

To use PlaybackRegion and LoopRegion, set the **PlaybackRegionsEnabled** property to true first.

> When Playback Regions Enabled is on, Start Time Position is ignored and PlaybackRegion controls the playback range.

#### PlaybackRegion (setting the playback segment)

Set the start and end of the sound in seconds. For example, use it to play only the 5–20 second part of a 30-second sound.

```lua
local Sound = script.Parent

Sound.PlaybackRegionsEnabled = true
Sound.PlaybackRegion = NumberRange.new(5, 20)
Sound:Play()
```

#### LoopRegion (setting the loop segment)

When Looped is true, this sets the segment to repeat on each loop. The first play uses PlaybackRegion; subsequent loops use LoopRegion.

```lua
local Sound = script.Parent

Sound.PlaybackRegionsEnabled = true
Sound.Looped = true

Sound.PlaybackRegion = NumberRange.new(0, 30)

Sound.LoopRegion = NumberRange.new(10, 25)

Sound:Play()
```

**Notes:**

- All negative values are clamped to 0
- Values beyond TimeLength are clamped to TimeLength
- When Min = Max, that Region setting is ignored

#### Practical example

**Background music intro + loop**

```lua
local BGM = script.Parent

BGM.PlaybackRegionsEnabled = true
BGM.Looped = true

BGM.PlaybackRegion = NumberRange.new(0, 60)

BGM.LoopRegion = NumberRange.new(15, 60)

BGM:Play()
```

### Position-Based Playback <a href="#position-based-playback" id="position-based-playback"></a>

Position-based playback lets you make sound attenuate naturally with distance and position. For example, you can represent rain heard in a specific area or engine noise fading as a car moves away. These settings are effective for improving spatial awareness and immersion in the game.

<figure><img src="../../../.gitbook/assets/image (117).png" alt=""><figcaption></figcaption></figure>

You can set distance with the **Roll Off Max Distance** and **Roll Off Min Distance** properties, and set attenuation with the **Roll Off Mode** property.

<table><thead><tr><th width="247">Property</th><th>Description</th></tr></thead><tbody><tr><td>Roll Off Max Distance</td><td>Maximum distance at which the sound can be heard</td></tr><tr><td>Roll Off Min Distance</td><td>Minimum distance at which the sound is heard at full volume</td></tr><tr><td>Roll Off Mode</td><td><p>How the sound attenuates with distance</p><ul><li>Inverse: Sound attenuates inversely with distance</li><li>Linear: Attenuates linearly</li><li>Linear Square: Attenuates with the square of distance</li><li>Inverse Tapered: Softer attenuation at close range</li></ul></td></tr></tbody></table>

Each Roll Off Mode type can be used as follows:

- **Inverse:** Explosion sounds (sound gets gradually quieter as the player moves away)
- **Linear:** Background music from a radio (sound decreases evenly with distance)
- **Linear Square:** Gunfire (loud at close range, drops off quickly at distance)
- **Inverse Tapered:** Wind (gradual decrease at close range)

## Usage Examples <a href="#usage-examples" id="usage-examples"></a>

### Game background music <a href="#game-background-music" id="game-background-music"></a>

```lua
local Workspace = game:GetService("Workspace")
local GameBGM = Workspace.GameBGM

local function PlayGameBGM(isPlay)
    GameBGM.Playing = isPlay
end
PlayGameBGM(true)
```

### KillPart collision sound effect <a href="#killpart-collision-sound-effect" id="killpart-collision-sound-effect"></a>

```lua
local Workspace = game:GetService("Workspace")
local Part = Workspace.Part

local function OnTouched(otherPart)
    local partParent = otherPart.Parent
    local humanoid = partParent:FindFirstChild("Humanoid")

    if humanoid then
        humanoid:TakeDamage(100)

        local killSFX = Instance.new("Sound")
        killSFX.SoundId = "ovdrassetid://1234"
        killSFX.Volume = 1
        killSFX.Parent = Part
        killSFX.Playing = true
    end
end
Part.Touched:Connect(OnTouched)
```

### Button sound effect <a href="#button-sound-effect" id="button-sound-effect"></a>

```lua
local Workspace = game:GetService("Workspace")
local ScreenGui = script.Parent
local ImageButton = ScreenGui.ImageButton

local function OnActivated()
    print("Activated!")

    local buttonSFX = Instance.new("Sound")
    buttonSFX.SoundId = "ovdrassetid://1234"
    buttonSFX.Volume = 1
    buttonSFX.Parent = Workspace
    buttonSFX.Playing = true
end
ImageButton.Activated:Connect(OnActivated)
```

## Advanced Usage <a href="#advanced-usage" id="advanced-usage"></a>

### Sound groups <a href="#sound-groups" id="sound-groups"></a>

SoundGroup is an object that lets you control multiple sounds together.

To attach a Sound to a specific group, you must set the **SoundGroup** property directly. Simply parenting the Sound under a SoundGroup in the hierarchy does not link it to that group.

```lua
local SoundGroup = script.Parent

SoundGroup.Volume = 0.2
```
