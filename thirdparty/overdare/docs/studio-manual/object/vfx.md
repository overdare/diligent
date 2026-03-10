# VFX

## Overview <a href="#overview" id="overview"></a>

VFX objects enhance a game’s visual elements, adding immersion and excitement. They can be applied to parts, characters, and environments, enriching gameplay experiences.

## Types of VFX <a href="#types-of-vfx" id="types-of-vfx"></a>

<table><thead><tr><th width="194">VFX</th><th>Description</th><th>Examples</th></tr></thead><tbody><tr><td>ParticleEmitter</td><td>Generates particles</td><td>Fire, smoke, explosions, magic, water droplets, etc.</td></tr><tr><td>Beam</td><td>Connects two points</td><td>Lasers, electricity, energy beams, etc.</td></tr><tr><td>Trail</td><td>Trail (trajectory) effect</td><td>Speed boosts, magic trails, bullet traces, etc.</td></tr><tr><td>VFXPreset</td><td>including a total of 27 preconfigured VFX presets</td><td>Fire, Heal, Barrier, Dash, etc.</td></tr></tbody></table>

## ParticleEmitter <a href="#particleemitter" id="particleemitter"></a>

<figure><img src="../../../.gitbook/assets/particle.webp" alt=""><figcaption></figcaption></figure>

### Properties <a href="#properties" id="properties"></a>

<table><thead><tr><th width="251">Property</th><th>Description</th></tr></thead><tbody><tr><td>Acceleration</td><td>Direction and magnitude of acceleration</td></tr><tr><td>Brightness</td><td>Particle brightness</td></tr><tr><td>Color</td><td>Particle color</td></tr><tr><td>Light Emission</td><td>Determines how much light the particle emits</td></tr><tr><td>Orientation</td><td><p>Defines particle rotation direction</p><ul><li>Facing Camera : Aligns the particle to always face the player's camera (the direction the player is looking)</li><li>Facing Camera World Up : Faces the camera but the particles maintain an upward orientation based on world Y-axis</li><li>Velocity Parallel : Particles align parallel to the velocity vector.</li><li>Velocity Perpendicular : Particles align perpendicular to the velocity vector.</li></ul></td></tr><tr><td>Size</td><td>Particle size</td></tr><tr><td>Texture</td><td>Texture Id for the particle (ovdrassetid://number format)</td></tr><tr><td>Transparency</td><td>Adjusts particle transparency</td></tr><tr><td>Drag</td><td>Air resistance effect</td></tr><tr><td>Enabled</td><td>Toggles particle activation</td></tr><tr><td>Emission Direction</td><td><p>Determines the direction of particle emission</p><ul><li>Top : Emits upwards</li><li>Right : Emits to the right</li><li>Back : Emits backward</li><li>Left : Emits to the left</li><li>Bottom : Emits downward</li><li>Front: Emits forward</li></ul></td></tr><tr><td>Life Time</td><td>Duration before a generated particle disappears</td></tr><tr><td>Rate</td><td>Number of particles generated per second</td></tr><tr><td>Rot Speed</td><td>Rotation speed</td></tr><tr><td>Rotation</td><td>Initial rotation angle</td></tr><tr><td>Speed</td><td>Initial velocity</td></tr><tr><td>Spread Angle</td><td>Angle range for particle emission</td></tr><tr><td>Squash</td><td>Compression effect applied to particles</td></tr><tr><td>Flipbook Layout</td><td><p>Defines the animation texture sheet layout (rows and columns)</p><ul><li>None : No flipbook animation</li><li>Grid 2x2 : Divides the texture into a 2×2 grid</li><li>Grid 4x4 : Divides the texture into a 4×4 grid</li><li>Grid 8x8 : Divides the texture into an 8×8 grid</li></ul></td></tr><tr><td>Flipbook Framerate</td><td>Frame rate of the animated texture</td></tr><tr><td>Flipbook Mode</td><td><p>Animation playback mode</p><ul><li>Loop : Repeats animation from start to finish</li><li>One Shot : Plays animation once</li><li>Ping Pong : Plays forward, then reverses back</li><li>Random : Plays frames in random order</li></ul></td></tr><tr><td>Flipbook Start Random</td><td>Starts animation from a random frame</td></tr><tr><td>Shape</td><td><p>Defines the initial particle emission shape</p><ul><li>Box : Particles spawn within a box-shaped area</li><li>Sphere: Particles spawn within a spherical area</li><li>Cylinder : Particles spawn within a cylindrical area</li><li>Disc : Particles spawn within a disc-shaped area</li></ul></td></tr><tr><td>Shape in Out</td><td><p>Sets the movement pattern of particles during emission and dissipation</p><ul><li>Outward : Particles are emitted outward from the shape area</li><li>One : Particles are emitted inward toward the shape area</li></ul></td></tr><tr><td>Shape Style</td><td><p>Sets the style of particle emission</p><ul><li>Volume : Particles are emitted from random positions within the shape's volume</li><li>Surface : Particles are emitted only from the surface of the shape</li></ul></td></tr><tr><td>LockedToPart</td><td>Whether particles should move along with the object they are attached to</td></tr></tbody></table>

### Script Feature <a href="#script-feature" id="script-feature"></a>

{% content-ref url="../../../development/api-reference/classes/particleemitter.md" %}
[particleemitter.md](../../../development/api-reference/classes/particleemitter.md)
{% endcontent-ref %}

## Beam <a href="#beam" id="beam"></a>

<figure><img src="../../../.gitbook/assets/Beam.gif" alt=""><figcaption></figcaption></figure>

An object that connects between two Attachments. They are automatically connected when you specify a start and end point, and are used to create effects like lasers, electricity, and energy beams.

### Properties <a href="#properties" id="properties"></a>

<table><thead><tr><th width="251">Property</th><th>Description</th></tr></thead><tbody><tr><td>Color</td><td>Beam color</td></tr><tr><td>Enabled</td><td>Activation status</td></tr><tr><td>Texture</td><td>Beam texture</td></tr><tr><td>Texture Length</td><td>Texture repetition length</td></tr><tr><td>Texture Speed</td><td>Texture movement speed</td></tr><tr><td>Transparency</td><td>Transparency</td></tr><tr><td>Attachment 0</td><td>Beam starting point</td></tr><tr><td>Attachment 1</td><td>Beam ending point</td></tr><tr><td>CurveSize0</td><td>Defines the position of the second control point of the Bézier curve that composes the beam, together with Attachment0.</td></tr><tr><td>CurveSize1</td><td>Defines the position of the third control point of the Bézier curve that composes the beam, together with Attachment1.</td></tr><tr><td>Width 0</td><td>Beam starting width</td></tr><tr><td>Width 1</td><td>Beam ending width</td></tr><tr><td>Face Camera</td><td>Sets the beam to always face the camera.</td></tr></tbody></table>

### Script Feature <a href="#script-feature" id="script-feature"></a>

{% content-ref url="../../../development/api-reference/classes/beam.md" %}
[beam.md](../../../development/api-reference/classes/beam.md)
{% endcontent-ref %}

## Trail <a href="#trail" id="trail"></a>

<figure><img src="../../../.gitbook/assets/Trail.gif" alt=""><figcaption></figcaption></figure>

An object that creates a trail (trajectory) effect left behind by a moving object. Used to create effects such as sword effects, speed boosts, magic trajectories, and bullet trails.

By setting Trail as a child of a specific object, such as Part, you can display effects trailing the movement of that object.

### Properties <a href="#properties-1" id="properties-1"></a>

<table><thead><tr><th width="251">Property</th><th>Description</th></tr></thead><tbody><tr><td>Color</td><td>Trail color</td></tr><tr><td>Texture</td><td>Trail texture</td></tr><tr><td>Texture Length</td><td>Texture repetition length</td></tr><tr><td>Texture Speed</td><td>Texture movement speed</td></tr><tr><td>Transparency</td><td>Transparency</td></tr><tr><td>Enabled</td><td>Activation status</td></tr><tr><td>Lifetime</td><td>The amount of time that a trail is kept after it is created (in seconds)</td></tr><tr><td>Width</td><td>Default width</td></tr><tr><td>Width Scale</td><td>Defines how width changes over time</td></tr><tr><td>Offset</td><td>Repositions the Trail in the X, Y, and Z directions</td></tr></tbody></table>

### Script Feature <a href="#script-feature-1" id="script-feature-1"></a>

{% content-ref url="../../../development/api-reference/classes/trail.md" %}
[trail.md](../../../development/api-reference/classes/trail.md)
{% endcontent-ref %}

## VFXPreset

<figure><img src="../../../.gitbook/assets/VFXPresetPreview.gif" alt=""><figcaption></figcaption></figure>

This is an object that allows you to quickly create visual effects commonly used in games (e.g., fire, explosions, barriers, healing) by selecting from a set of predefined effects without the need for additional editing.

### How to Use

Place a VFXPreset in the Level Browser and select it. Then, in the Properties panel, locate the VFX Preset properties and click the displayed button to open the VFX Preset Selection popup.

In the VFX Preset Selection popup, select the desired effect such as Buff Zone, Trail, etc., and the effect will be applied.

<figure><img src="../../../.gitbook/assets/image (167).png" alt=""><figcaption></figcaption></figure>

### Properties

<table><thead><tr><th width="251">Properties</th><th>Description</th></tr></thead><tbody><tr><td>VFX Preset</td><td>Selects the VFX to display</td></tr><tr><td>Importance</td><td>Sets the importance of the VFXPreset. The internal Performance Type is determined by combining this with the Infinite Loop setting.</td></tr><tr><td>Color</td><td>Color of VFX Preset</td></tr><tr><td>Size</td><td>Size of VFX Preset</td></tr><tr><td>Transparency</td><td>Transparency of VFX Preset</td></tr><tr><td>Enabled</td><td>Activation status</td></tr><tr><td>Infinite Loop</td><td>Infinite Loop</td></tr><tr><td>Loop Count</td><td>Number of loops to play</td></tr></tbody></table>

#### Importance and Performance Type Mapping

The Performance Type is internally determined based on the combination of the Importance value and the Infinite Loop setting, as shown below.

<table><thead><tr><th width="200">Importance</th><th width="200">Infinite Loop</th><th>Performance Type</th></tr></thead><tbody><tr><td>Default</td><td>False</td><td>Default Burst</td></tr><tr><td>Default</td><td>True</td><td>Default Looping</td></tr><tr><td>Background</td><td>False</td><td>Background Burst</td></tr><tr><td>Background</td><td>True</td><td>Background Looping</td></tr><tr><td>Gameplay</td><td>False</td><td>Gameplay Burst</td></tr><tr><td>Gameplay</td><td>True</td><td>Gameplay Looping</td></tr><tr><td>Critical</td><td>-</td><td>Critical</td></tr></tbody></table>

### Script Feature

{% content-ref url="../../../development/api-reference/classes/vfxpreset.md" %}
[vfxpreset.md](../../../development/api-reference/classes/vfxpreset.md)
{% endcontent-ref %}

## Properties Supported by the Curve Editor <a href="#properties-supported-by-the-curve-editor" id="properties-supported-by-the-curve-editor"></a>

Properties that can be edited with the Curve Editor are marked with a … button next to them. Clicking this button opens the **Curve Editor**, where you can intuitively plot the change in value of that property in graphical form.

<figure><img src="../../../.gitbook/assets/image (120).png" alt=""><figcaption></figcaption></figure>
