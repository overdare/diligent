# Lighting

## Overview <a href="#overview" id="overview"></a>

Lighting plays a crucial role in game design, serving not only as a tool for visual representation but also as a key mechanism that can completely transform the player’s experience. In the early days of game development, the technical implementation of lighting was limited. However, as technology advanced, lighting has become increasingly important not only for visual aesthetics but also for interaction, storytelling, immersion, and guiding player behavior.

OVERDARE Studio provides a variety of lighting solutions to deliver a complete gaming experience. Lighting services are broadly divided into **local lighting** and **global lighting**, each with its own characteristics and uses to meet diverse game design needs.



## **Local Lighting (Point Light** and **Spotlight)** <a href="#local-lighting-point-light-and-spotlight" id="local-lighting-point-light-and-spotlight"></a>

Local lighting operates within specific areas, applying light effects only where necessary. This makes it an effective tool for emphasizing certain elements in gameplay and level design or directing the player’s attention.

* **Point Light**: Emits light in all directions from a single point. It is ideal for illuminating small areas, such as highlighting an item or lighting up a small room.
* **Spotlight**: A light that radiates in a specific direction, providing focused lighting on narrow areas or important parts. Its conical light effect is commonly used for stage lighting or boss enemy introduction scenes.



### Lighting Properties <a href="#lighting-properties" id="lighting-properties"></a>

Local lighting is limited to specific locations and is used to express the atmosphere of particular places or objects. It plays a vital role in creating special sensory effects during gameplay and is often used to guide players to focus on specific areas.



#### **1.1. Point Light**

A point light emits light in all directions from a single point, acting as an omnidirectional light source.

<table><thead><tr><th width="247">Property</th><th>Description</th></tr></thead><tbody><tr><td>Range</td><td>The range the light covers</td></tr><tr><td>Brightness</td><td>The intensity of the light</td></tr><tr><td>Color</td><td>The color of the light</td></tr><tr><td>Shadows</td><td>Whether the light creates shadow effects</td></tr></tbody></table>



#### **1.2. Spotlight**

A spotlight emits light in a specific direction, forming a cone-shaped illumination area for a more precise control over lighting.

<table><thead><tr><th width="247">Property</th><th>Description</th></tr></thead><tbody><tr><td>Angle</td><td>The spread angle of the light</td></tr><tr><td>Face</td><td>The direction the light is cast towards</td></tr><tr><td>Angle</td><td>The range the light covers</td></tr><tr><td>Brightness</td><td>The intensity of the light</td></tr><tr><td>Color</td><td>The color of the light</td></tr><tr><td>Shadows</td><td>Whether the light creates shadow effects</td></tr></tbody></table>



### Placing lights in OVERDARE Studio <a href="#placing-lights-in-overdare-studio" id="placing-lights-in-overdare-studio"></a>

Local lighting is used to highlight specific areas in the game or customize lighting effects. To implement this, **lighting instances** must be placed as children of specific objects (e.g., Part). Follow the steps below to place and adjust lighting.



1.  **Preparing for Light Placement**

    To place lighting, first create a **Part** in the Workspace. A Part is a basic object that can have lighting instances like **SpotLight** or **PointLight** as its children.
2.  **Adding Lighting Instances**

    Add a SpotLight or PointLight as a child of the created Part. This allows you to set the light’s position, direction, and range relative to the Part.

    <figure><img src="../../../.gitbook/assets/lighting-1.png" alt=""><figcaption></figcaption></figure>

    <figure><img src="../../../.gitbook/assets/lighting-2.png" alt=""><figcaption></figcaption></figure>
3.  **Adjusting Light Position and Direction**

    Move or rotate the placed Part to easily adjust the light’s position and angle. Moving the Part changes the light’s center position, and using the Orientation property allows for more precise angle adjustments.\\

    <figure><img src="../../../.gitbook/assets/lighting-3.png" alt=""><figcaption></figcaption></figure>

    <figure><img src="../../../.gitbook/assets/lighting-4.png" alt=""><figcaption></figcaption></figure>
4.  **Setting Light Properties**

    The lighting instance added as a child of the Part can be customized through various attributes:

    * **Direction**: Can be set in 6 directions (up, down, left, right, front, back) relative to the Part.
    * **Color, Range, and Brightness:** Modify the instance’s properties to set the light’s color, range, and brightness in detail.
5.  **Verifying Light Placement**

    Move the Part and lighting instance together to ensure proper alignment within the level design. This helps developers achieve the best lighting effects for their environment.



## **Global Lighting** <a href="#global-lighting-lighting-service" id="global-lighting-lighting-service"></a>

Global lighting affects the entire map, playing a crucial role in defining the game’s overall mood and style.

* A dark global lighting creates a sense of tension, encouraging players to explore cautiously.
* Conversely, bright global lighting fosters a festive and vibrant atmosphere, making the world feel open and inviting. OVERDARE provides powerful global lighting solutions, including brightness adjustments, time-of-day settings (day and night), and color control.



### **Lighting Service** Properties

Lighting Services provide functionality to control global lighting. Global lighting is applied evenly across the entire game, adjusting the overall atmosphere of the game map and significantly impacting the game environment.

<table><thead><tr><th width="247">프로퍼티</th><th>설명</th></tr></thead><tbody><tr><td>ClockTime</td><td>Allows for day and night representation by setting the time. The direction and intensity of the global lighting are adjusted according to the time of day.</td></tr><tr><td>Saturation</td><td>Adjusts the saturation level of the global color. Lower values result in a duller look, while higher values produce more vivid and vibrant colors.</td></tr><tr><td>Contrast</td><td>Adjusts the contrast of the sky to enhance the depth of clouds, atmosphere, and colors, thereby increasing visual immersion.</td></tr><tr><td>Night Brightness</td><td>Sets the overall lighting brightness during nighttime. Used to create a dark atmosphere or simulate moonlight effects.</td></tr><tr><td>Auto Time Cycle</td><td>Enables automatic cycling of day and night phases. When activated, time progresses naturally based on the Time Flow Speed. Note that time progression applies only during runtime.</td></tr><tr><td>Time Flow Speed</td><td>Sets the speed at which the day/night cycle progresses. Higher values result in shorter time intervals between changes.</td></tr><tr><td>Real Time Day Duration</td><td>The actual duration of the day/night cycle based on the current Time Flow Speed. <em>(Read-only, e.g., 20 m / 00 s)</em></td></tr><tr><td>Sun Path Angle</td><td>Sets the angle of the sun's path. Used to simulate seasonal sun elevation or the direction of sunlight.</td></tr><tr><td>Sun Max Height</td><td>Sets the maximum elevation (height) the sun can reach.</td></tr><tr><td>Sun Light Color</td><td>Specifies the color of sunlight. Used to recreate the natural lighting of daytime.</td></tr><tr><td>Sun Brightness</td><td>Sets the brightness of the sunlight. Higher values produce stronger daylight effects.</td></tr><tr><td>Sun Cast Shadow</td><td>Determines whether the sunlight casts shadows.</td></tr><tr><td>Moon Path Angle</td><td>Sets the angle of the moon's path. Used to simulate changes in the moon's orbit or position.</td></tr><tr><td>Moon Max Height</td><td>Sets the maximum elevation the moon can reach.</td></tr><tr><td>Moon Cast Shadow</td><td>Determines whether the moonlight casts shadows.</td></tr><tr><td>Moon Brightness</td><td>Adjusts the brightness of the moonlight.</td></tr><tr><td>Moon Light Color</td><td>Specifies the color of moonlight. Used to recreate the natural lighting of nighttime.</td></tr><tr><td>Moon Material Color</td><td>Sets the surface color of the moon and the color of surrounding clouds.</td></tr><tr><td>Moon Phase</td><td>Adjusts the moon's phase (full moon, half moon, crescent, etc.) to change its appearance.</td></tr><tr><td>Star Brightness</td><td>Sets the brightness of stars, determining how visible they appear in the night sky.</td></tr><tr><td>Stars Color</td><td>Specifies the color of starlight.</td></tr><tr><td>Ambient Sky Brightness</td><td>Sets the ambient light brightness for both day and night.</td></tr><tr><td>Ambient Sky Color</td><td>Specifies the sky color for both day and night.</td></tr><tr><td>Ground Reflection Color</td><td>Adjusts the color of light reflected from the ground.</td></tr><tr><td>Sky Color Influence</td><td>Controls how much the fog reflects the sky color.</td></tr></tbody></table>



### Atmosphere Properties

Atmosphere Services provide control over the overall look and feel of the sky and atmosphere. By adjusting in-game elements such as sky color, fog, clouds, and air density, it enhances depth and realism in the sky. Along with lighting, it plays a key role in setting the overall mood of the game environment.

<table><thead><tr><th width="247">프로퍼티</th><th>설명</th></tr></thead><tbody><tr><td>Air Color</td><td>Adjusts the overall tint of the atmosphere.</td></tr><tr><td>Fog Density</td><td>Sets the density of the fog. Higher values result in heavier, more obscured visibility.</td></tr><tr><td>Fog Falloff</td><td>Adjusts how quickly the fog fades over distance. Lower values cause a gradual fade, while higher values make the fog dissipate more abruptly.</td></tr><tr><td>Fog Start</td><td>Specifies the distance from the camera at which the fog begins.</td></tr><tr><td>Fog Color</td><td>Sets the color of the fog. Can be adjusted to match the mood or time of day.</td></tr><tr><td>Fog Horizon</td><td>When enabled, the skybox is excluded from the fog effect.</td></tr><tr><td>Haze Color</td><td>Specifies the color of light scattering caused by particles in the atmosphere.</td></tr><tr><td>Haze Spread</td><td>Adjusts the intensity of light scattering caused by particles in the atmosphere.</td></tr><tr><td>Glare Falloff</td><td>Controls the intensity of sunlight or moonlight scattering in the atmosphere.</td></tr><tr><td>Glare Color</td><td>Specifies the atmospheric scattering color of sunlight or moonlight.</td></tr><tr><td>Cloud Amount</td><td>Adjusts the amount and density of clouds.</td></tr><tr><td>Cloud Texture</td><td>Specifies the cloud texture. Used to define the shape, texture, and density of the clouds.</td></tr><tr><td>Cloud Speed</td><td>Sets the speed at which clouds move. Useful for simulating strong winds or slow drifting skies.</td></tr></tbody></table>



### Vertex Fog – Important Notes

When using **imported low-poly meshes** instead of the default Baseplate or BasePart (which internally apply LOD), **Fog quality may degrade** depending on the mesh’s vertex count.

To avoid this issue, it is recommended to prioritize using the **default Baseplate or BasePart for floors or large surface areas**. If **custom meshes** are used, vertex density and **Fog quality should be thoroughly tested** in advance.

&#x20;

**LOD Behavior of Baseplate and BasePart**

* The LOD for Baseplate and default BasePart operates using three predefined levels: 0 / 1 / 2.
  * For the **Block type**, an additional Extra LOD level is applied to ensure visual quality even when used at very large sizes (Size property of 100,000 or more), similar to the Baseplate.
  * For **non-Block types**, the Extra LOD level is not supported. As a result, Fog quality degradation may occur when these parts are used at sizes exceeding 100,000.



### Adjusting Lighting Service via Scripting <a href="#adjusting-lighting-service-via-scripting" id="adjusting-lighting-service-via-scripting"></a>

Using scripts, you can create dramatic lighting effects. By modifying the game world’s ClockTime, you can transition between day and night or create an effect where time flows quickly.

{% embed url="https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FhRPi87oM9ttlk5nyu7L7%2Fuploads%2F0uBlrFUS4Ricppu5EpbO%2F2025-02-03%2016-23-21.mp4?alt=media&token=e0a4ff6d-8b57-4485-b012-e8d59aedb93b" %}

```lua
local Lighting = game:GetService("Lighting")
local RunService = game:GetService("RunService")

local ClockTime = 0

local function OnHeartbeat(deltaTime)
    ClockTime = ClockTime + (deltaTime * 10)
    Lighting.ClockTime = ClockTime
end
RunService.Heartbeat:Connect(OnHeartbeat)
```

You can also create tension by changing the ambient light color to red during dangerous situations.



## Tips for Expressing Density Effects in Roblox

To achieve a visual effect similar to Roblox’s FogDensity in OVERDARE, multiple environment properties must be adjusted together.



1. Enter an appropriate value for the Fog setting
2. Set the Fog Color to black (0, 0, 0) in the Atmosphere
3. Enable Fog Horizon in Atmosphere
4. Increase the Sky Color Influence value in Lighting



These settings are not dependent on application order, and the higher the Fog value is, the more clearly a Roblox-style Density Fog effect will be expressed.



<div><figure><img src="../../../.gitbook/assets/Density-1.png" alt=""><figcaption><p>Density effect disabled</p></figcaption></figure> <figure><img src="../../../.gitbook/assets/Density-2.png" alt=""><figcaption><p>Density effect enabled<br><br>Sky Color Influence = 2<br>Fog Color = 0, 0, 0<br>Fog Horizon = true</p></figcaption></figure></div>



## Lighting Applications <a href="#lighting-applications" id="lighting-applications"></a>

### Maximizing Neon Material Effects <a href="#maximizing-neon-material-effects" id="maximizing-neon-material-effects"></a>

OVERDARE provides a default Neon material that makes Parts/MeshParts appear as if they are glowing. However, this effect is limited to the object’s surface and does not illuminate surrounding objects. To create a more dramatic effect, you can place a Point Light within a Neon-material Part and match the light color to the Neon color. This will create a more surreal and visually striking effect.

Highlighting Characters Place an invisible Part near the character and shine a Spotlight on them to make the character stand out brighter than other objects. This can be used to highlight a character’s abnormal state or create a blinking, glowing effect like Super Mario.

Creating a Cyberpunk and Retro Atmosphere with Neon Material Unlike lights, Neon Material does not affect other objects. To make neon objects influence the surfaces of other objects like real neon signs, you can add Point Lights. This creates a more realistic neon sign effect.

<figure><img src="../../../.gitbook/assets/image (105).png" alt=""><figcaption></figcaption></figure>

<figure><img src="../../../.gitbook/assets/image (106).png" alt=""><figcaption></figcaption></figure>



## Usage Examples <a href="#usage-examples" id="usage-examples"></a>

### 1. **Setting the Overall Atmosphere of the Game** <a href="#setting-the-overall-atmosphere-of-the-game" id="setting-the-overall-atmosphere-of-the-game"></a>

Lighting plays an essential role in creating the game’s atmosphere. Factors like brightness, color, and intensity can significantly change how players perceive and feel about the game world. For example:

* **Warm, soft lighting** provides comfort and is often used in towns or safe areas.
* **Dark and harsh lighting** evokes tension and fear, contributing to an immersive experience in horror games.
* **Vibrant colored lighting, such as neon,** creates a lively, futuristic atmosphere, frequently used in cyberpunk-themed worlds.

Lighting can effectively convey the theme and mood of the game world, allowing players to immerse themselves more deeply in the experience, beyond just viewing the screen.



### 2. **Guiding the Player’s Attention** <a href="#guiding-the-players-attention" id="guiding-the-players-attention"></a>

Lighting is a powerful tool for guiding player focus toward specific objects or areas. Through this, game developers can naturally influence player decisions or highlight story-related objects.

* **Point Light**: Focused lighting at specific locations can draw attention to important items or objects, alerting players to their significance.
* **Spotlight**: By emphasizing characters or monsters, spotlights help players clearly identify the main point of interest at any given moment.
* Combination of **Global and Local Lighting**: In a generally dark map, bright local lighting can pull the player’s attention to a specific location.

This technique of guiding attention is essential for game design, and the proper use of lighting significantly improves the quality of level design.



### 3. **Enhancing Immersion and Eliciting Emotional Responses** <a href="#enhancing-immersion-and-eliciting-emotional-responses" id="enhancing-immersion-and-eliciting-emotional-responses"></a>

Lighting also directly influences the player’s emotional experience. Dark and unsettling lighting before difficult areas or boss battles can amplify tension. Conversely, after achieving a goal or receiving a reward, bright, soft lighting can evoke a sense of accomplishment.

* For example: In horror games, flickering lights or dark shadows are used to create anxiety and maintain a sense of unease throughout the experience.
* Bright and natural lighting in open fields symbolizes freedom of exploration, encouraging players to discover more places in adventure games.

By using lighting as an emotional and psychological tool, players become more immersed in the game world, and the storytelling impact is amplified.



### 4. **Purposefully Creating Discomfort** <a href="#purposefully-creating-discomfort" id="purposefully-creating-discomfort"></a>

Sometimes, developers use lighting to intentionally create a “sense of discomfort or strangeness” for the player. For instance, extremely dark environments, tilted light directions, or unnaturally glowing elements can make the player feel confused or challenged. This approach is particularly effective in horror, puzzle, or exploration genres.
