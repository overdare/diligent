# VFX Preset Performance Optimization

## Overview

To use VFX Presets more efficiently, various performance types are automatically determined by combining **Importance** and **Infinite Loop** settings. This allows creators to optimize according to the characteristics of each effect type.

Additionally, by managing VFX Presets based on a fixed budget, creators can not only save resources but also **maintain balanced quality and performance** for each effect type. This approach makes it easier and more efficient for creators to handle VFX presets during development.

## VFX Preset Budgeting

VFX Presets consume significant device performance. The more they are used, the higher the quality, but this can degrade the play experience due to performance drops. To ensure performance, VFX usage must be minimized, but this reduces the game's visual appeal.

To address this, OVERDARE Studio automatically classifies Performance Types based on the Importance and Infinite Loop settings, and allocates resources for each type, providing creators with the ability to easily use VFX while ensuring performance.\\

### Restrictions

<table><thead><tr><th width="219.3333740234375">Classification</th><th>Restrictions</th></tr></thead><tbody><tr><td><strong>Budget Update Cycle</strong></td><td><ul><li>Spawn: Updates budget when placed in the world or enabled</li><li>Tick: Updates budget by calculating priority at regular intervals</li></ul></td></tr><tr><td><strong>How ​​to prioritize within a budget</strong></td><td><ul><li>Distance: Prioritizes display based on proximity to the camera</li><li>Age: Prioritizes display based on the order of recent spawning</li></ul></td></tr><tr><td><strong>How ​​to handle budget overruns</strong></td><td><ul><li>Kill: Disables rendering (cannot be reactivated)</li><li>Asleep: Temporarily disabled; can be reactivated when resources are available</li></ul></td></tr><tr><td><strong>Expression Maximum Distance</strong></td><td>Exclude from budget if the maximum distance from the camera is exceeded</td></tr><tr><td><strong>Maximum Instance Count</strong></td><td>Maximum allowed instances per performance type</td></tr><tr><td><strong>Maximum Number of Identical Effects</strong></td><td>Maximum number of identical effects within the same performance type</td></tr></tbody></table>

### Importance and Performance Type Mapping

The Performance Type is automatically determined internally based on the combination of the VFXPreset's **Importance** and **Infinite Loop** settings, as shown below.

<table data-full-width="true"><thead><tr><th width="200">Importance</th><th width="180">Infinite Loop</th><th width="280">Performance Type</th><th>Description</th><th>Usage Examples</th></tr></thead><tbody><tr><td><strong>Default</strong></td><td>False</td><td>Default Burst</td><td>One-shot VFX that must be played regardless of performance</td><td>Essential visual effects</td></tr><tr><td><strong>Default</strong></td><td>True</td><td>Default Looping</td><td>Looping VFX that must be played regardless of performance</td><td>Essential looping visual effects</td></tr><tr><td><strong>Background</strong></td><td>False</td><td>Background Burst</td><td>VFX that plays at a specific point in the background</td><td>Sparks, smoke effects</td></tr><tr><td><strong>Background</strong></td><td>True</td><td>Background Looping</td><td>VFX that continuously plays in the background</td><td>Torch, rain effects</td></tr><tr><td><strong>Gameplay</strong></td><td>False</td><td>Gameplay Burst</td><td>VFX that briefly plays at certain points during gameplay</td><td>Hit effects, level-up/item acquisition effects</td></tr><tr><td><strong>Gameplay</strong></td><td>True</td><td>Gameplay Looping</td><td>Gameplay VFX that loops continuously</td><td>Shield, buff aura effects</td></tr><tr><td><strong>Critical</strong></td><td>-</td><td>Critical</td><td>VFX that must be expressed in gameplay</td><td>Scoring effects, start/end conditional effects</td></tr></tbody></table>

## Resource Limits by Performance Type

### Resource Limits in General Specifications Options

<table data-full-width="true"><thead><tr><th width="239.8333740234375">Limitation</th><th align="center">Background Looping</th><th align="center">Background Burst</th><th align="center">Gameplay Looping</th><th align="center">Gameplay Burst</th><th align="center">Critical</th><th align="center">Default</th></tr></thead><tbody><tr><td><strong>Update Cycle</strong></td><td align="center">Tick (Medium)</td><td align="center">Spawn</td><td align="center">Tick (High)</td><td align="center">Spawn</td><td align="center">Spawn</td><td align="center">Spawn / Tick (Low)</td></tr><tr><td><strong>Priority Determination Criteria</strong></td><td align="center">Distance</td><td align="center">Distance</td><td align="center">Distance</td><td align="center">Age</td><td align="center">Age</td><td align="center">Distance</td></tr><tr><td><strong>How to handle exceeding budget</strong></td><td align="center">Asleep</td><td align="center">Kill</td><td align="center">Asleep</td><td align="center">Kill</td><td align="center">Kill</td><td align="center">Kill / Asleep</td></tr><tr><td><strong>Maximum expressible distance</strong></td><td align="center">10000</td><td align="center">5000</td><td align="center">10000</td><td align="center">12500</td><td align="center">No restrictions</td><td align="center">No restrictions</td></tr><tr><td><strong>Maximum number of instances for that budget</strong></td><td align="center">8</td><td align="center">8</td><td align="center">40</td><td align="center">60</td><td align="center">20</td><td align="center">88 / 48</td></tr><tr><td><strong>Limit the number of identical effects</strong></td><td align="center">4</td><td align="center">4</td><td align="center">10</td><td align="center">30</td><td align="center">20</td><td align="center">88 / 48</td></tr></tbody></table>

### Resource limits in low-spec options

<table data-full-width="true"><thead><tr><th width="239.833251953125">Limitation</th><th align="center">Background Looping</th><th align="center">Background Burst</th><th align="center">Gameplay Looping</th><th align="center">Gameplay Burst</th><th align="center">Critical</th><th align="center">Default</th></tr></thead><tbody><tr><td><strong>Update Cycle</strong></td><td align="center">Tick (Medium)</td><td align="center">Spawn</td><td align="center">Tick (High)</td><td align="center">Spawn</td><td align="center">Spawn</td><td align="center">Spawn / Tick (Low)</td></tr><tr><td><strong>Priority Determination Criteria</strong></td><td align="center">Distance</td><td align="center">Distance</td><td align="center">Distance</td><td align="center">Age</td><td align="center">Age</td><td align="center">Distance</td></tr><tr><td><strong>How to handle exceeding budget</strong></td><td align="center">Asleep</td><td align="center">Kill</td><td align="center">Asleep</td><td align="center">Kill</td><td align="center">Kill</td><td align="center">Kill / Asleep</td></tr><tr><td><strong>Maximum expressible distance</strong></td><td align="center">1250</td><td align="center">450</td><td align="center">2500</td><td align="center">1000</td><td align="center">No restrictions</td><td align="center">No restrictions</td></tr><tr><td><strong>Maximum number of instances for that budget</strong></td><td align="center">6</td><td align="center">6</td><td align="center">6</td><td align="center">25</td><td align="center">4</td><td align="center">32 / 12</td></tr><tr><td><strong>Limit the number of identical effects</strong></td><td align="center">3</td><td align="center">4</td><td align="center">4</td><td align="center">4</td><td align="center">2</td><td align="center">32 / 12</td></tr></tbody></table>

## How to Use

### Creating a VFX Preset

Create a VFX Preset in the Level Browser and adjust the desired effects, color, size, and more.

<figure><img src="../../../.gitbook/assets/image (168).png" alt=""><figcaption></figcaption></figure>

Learn More

{% content-ref url="../object/vfx.md" %}
[vfx.md](../object/vfx.md)
{% endcontent-ref %}

### Specifying Importance

Set the Importance of the effect. Decide based on the intended use and importance of the effect you are using. The internal Performance Type is automatically determined based on the combination of Importance and Infinite Loop settings.

<figure><img src="../../../.gitbook/assets/image (169).png" alt=""><figcaption></figcaption></figure>

### World Layout

Place the VFX Preset in the location or area where the effect should appear. If it does not need to be pre-placed in the world but dynamically placed during the game, store it in ReplicatedStorage or ServerStorage and place it in the world using Clone or Parent assignment.

```lua
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local VFXPreset = ReplicatedStorage:WaitForChild("VFXPreset")

local Workspace = game:GetService("Workspace")
local Part = Workspace:WaitForChild("Part")

local NewVFX = VFXPreset:Clone()
VFXPreset.Parent = Part
```

## Note

The Importance of a VFX Preset cannot be changed at runtime. When creating and placing a VFX Preset during runtime, create it in ReplicatedStorage or ServerStorage in advance and dynamically place it using Clone or similar methods.
