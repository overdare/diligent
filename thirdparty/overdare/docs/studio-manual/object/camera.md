# Camera

## Overview

In a game, the camera provides a **virtual viewpoint or perspective** that allows players to observe and interact with the game world. Like a real-world camera, the game camera is a crucial tool that conveys the virtual environment, character actions, and events to the player, significantly influencing the game’s immersion and player enjoyment.

The camera goes beyond simply illuminating a scene; it uses various techniques such as **movement** and **rotation** to deliver a rich experience to the player. By emphasizing visual effects or dramatically showcasing specific events, it maximizes the game’s atmosphere and **immersion**. It is also a **tool for effectively conveying various intended experiences**, as well as interactions between characters and the environment.

The camera’s perspective can completely change the way a game is played. For example, in **shooter games**, the camera perspective can provide entirely different gameplay experiences:



* **Top-Down View (TOP-View)**: Simple aiming and shooting makes it suitable for fast-paced action.
* **TPS (Third-Person Perspective) / FPS (First-Person Perspective)**: Requires more precise vision and tactical play, enhancing immersion in combat.



Thus, the camera’s perspective is not just a visual tool but a critical element that can alter the **core fun and strategy** of a game.



## Properties <a href="#properties" id="properties"></a>

<table><thead><tr><th width="246.6666259765625">속성</th><th>설명</th></tr></thead><tbody><tr><td>CFrame</td><td>The camera’s position and orientation</td></tr><tr><td>Focus</td><td>Currently not supported.</td></tr><tr><td>FieldOfView</td><td>The camera’s field of view (0 &#x3C; FOV &#x3C; 180)</td></tr><tr><td>ViewportSize</td><td>The size of the screen viewed through the camera</td></tr><tr><td>CameraSubject</td><td>The object the camera is focused on</td></tr><tr><td>CameraType</td><td>The type of camera</td></tr></tbody></table>



## How to Use the Camera <a href="#how-to-use-the-camera" id="how-to-use-the-camera"></a>

### Modifying Camera Properties <a href="#modifying-camera-properties" id="modifying-camera-properties"></a>

To directly adjust the camera, you need to edit the settings through **scripting**. While you can temporarily change values using the properties provided in the editor, **actual camera settings must be applied through code (script) to reflect the changes**.



### Specifying Camera Type <a href="#specifying-camera-type" id="specifying-camera-type"></a>

The camera can currently only be manipulated for **Custom** and **Scriptable** types.

* **CFrame** will not be modified unless the camera type is Scriptable, they are automatically determined by the default camera type.
* Using the Scriptable type allows for more detailed adjustments and control.



### Zooming In/Out Using FieldOfView and CFrame <a href="#zooming-inout-using-fieldofview-and-cframe" id="zooming-inout-using-fieldofview-and-cframe"></a>

FieldOfView is a key property for adjusting the camera’s field of view. It can be used to implement various custom camera effects:

* Reducing FOV provides a **Zoom-In** effect.
* Increasing FOV creates a **Wide-Angle** effect, similar to shooting with a wide-angle lens.



There are two ways to implement zooming in/out for your subject (e.g., the player):

* **Camera Position Adjustment:** Moving the camera forward or backward to achieve the zoom effect.
* **FieldOfView Adjustment:** Changing the field of view to implement zooming, which may introduce **screen distortion**.



Each method has its own characteristics, so the choice depends on the implementation goal. For example, to minimize distortion, use camera movement; for a stylish effect, use FOV adjustment.



🎥 Below are examples of zoom effects applied to the same subject using both methods:

* **Camera Movement Method:** Natural zooming in and out.
  * When zooming in/out, objects closer to the camera scale more noticeably, while distant objects show little change in size.
* **FOV Adjustment Method:** Distorted spatial perception when zooming in and out.
  * When zooming in/out, both near and distant objects scale similarly.
  * When zooming in, distant objects appear closer, creating a distorted effect.

<figure><img src="../../../.gitbook/assets/image 1.png" alt=""><figcaption><p>Default Subject Screen</p></figcaption></figure>

<figure><img src="../../../.gitbook/assets/Group 9.png" alt=""><figcaption><p>On the left, the camera is moved closer to the character. On the right, the camera's FOV is set to 30 degrees.</p></figcaption></figure>



* If you look at the zoomed-in state, the size of the trees in the background behind the character doesn’t change much with the camera movement method, whereas with the FOV method, the trees in the background seem much larger and closer.

<figure><img src="../../../.gitbook/assets/Group 10.png" alt=""><figcaption><p>On the left, the camera is moved far away from the character. On the right, the camera's FOV is set to 120 degrees.</p></figcaption></figure>



* In the zoomed out state, you can see that the size change of the trees is not noticeable when the camera is moved, while the background size seem much smaller when the FOV is changed.

<figure><img src="../../../.gitbook/assets/image 4.png" alt=""><figcaption><p>The camera's FOV is set to 160 degrees.</p></figcaption></figure>



* When the field of view is increased to a significant level, the screen exhibits severe distortion at the edges, similar to a fish-eye lens effect.



### Setting CameraSubject <a href="#setting-camerasubject" id="setting-camerasubject"></a>

The **CameraSubject** property specifies the subject the camera focuses on.

* **By default**, this is set to the player character.
* You can assign specific objects as the subject to create various effects.



<figure><img src="../../../.gitbook/assets/image (119).png" alt=""><figcaption><p>By changing the Subject to a red boxed Part, you can get a fixed camera effect at the cube position.</p></figcaption></figure>

{% embed url="https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FhRPi87oM9ttlk5nyu7L7%2Fuploads%2FTeVg52BtOt8RLam6NJou%2F2025-03-10%2014-40-24.mp4?alt=media&token=5d829807-2e84-49a0-8983-0af65c4d4de2" %}

The camera movement that is locked to a Part position. The camera no longer follows the character.



## Usage Examples <a href="#usage-examples" id="usage-examples"></a>

### Top-down View Camera <a href="#top-down-view-camera" id="top-down-view-camera"></a>

{% embed url="https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FhRPi87oM9ttlk5nyu7L7%2Fuploads%2FZrhMCxcBDz3fLJO4WH3H%2F2025-03-10%2017-27-23.mp4?alt=media&token=4951133c-2b00-445b-a03f-6f0b3826c01f" %}



The top-down view camera has the following characteristics:

* Provides a bird’s-eye view, looking down at the character from above.
* The camera follows the character at all times, keeping them centered or at a specific position on the screen.
* The camera does not rotate regardless of the character’s movement, reducing fatigue or motion sickness.
* Offers a wide field of view, suitable for tactical and strategic games.
* However, it can lead to a monotonous game screen, which can be boring.
* Typically, a player positioned higher on the screen can hide their character behind a wall, while it is difficult for a lower-positioned player to spot them.



To implement a top-down view, the following functionalities must be completed:

* Using a Scriptable Camera to always track the player character’s position
* Updating the camera’s position and viewing angle based on the character’s position

```lua
local Workspace = game:GetService("Workspace")
local RunService= game:GetService("RunService")
local Players = game:GetService("Players")

local Camera = Workspace.CurrentCamera
Camera.CameraType = Enum.CameraType.Scriptable

-- Acquiring the player character
local Character = Players.LocalPlayer.Character
Camera.CameraSubject = Character

-- Updating the Camera's CFrame Based on Character Position for each render step of the RunService
RunService.RenderStepped:Connect(function()
    local cameraPos = Character.HumanoidRootPart.Position + (Vector3.new(0, 0.5, 1) * 1200)	
    Camera.CFrame = CFrame.new(cameraPos.X, cameraPos.Y, cameraPos.Z) * CFrame.Angles(math.rad(-30), 0, 0)	
end)
```



### TPS Camera <a href="#tps-camera" id="tps-camera"></a>

{% embed url="https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2FhRPi87oM9ttlk5nyu7L7%2Fuploads%2FlaNy401W9EPpWtRV3Oqp%2F2025-03-10%2015-07-29.mp4?alt=media&token=7b623c15-5042-4633-813d-f0ceb1bd86da" %}

* Offers a perspective close to first-person while allowing the player to see their own character.
* The camera’s view remains clear even if the character’s body is blocked by objects, providing an open and unobstructed feel.
* Provides a broader field of view compared to FPS cameras while supporting free camera rotation.
* Provides long-distance visibility, allowing players to see distant objects clearly.



However,

* The camera’s direction (or crosshair) may not align with the character’s direction. In shooting games, this requires additional handling to ensure accurate targeting.
* (For example, while the crosshair may show an enemy clearly, the character’s position might be blocked by walls or objects, making it impossible to hit the target)
* Players can hide behind walls, remaining hidden from their opponent’s view while still being able to see their opponent. This kind of information asymmetry can lead to unfair gameplay in PvP scenarios.

<figure><img src="../../../.gitbook/assets/image (12) (1).png" alt=""><figcaption><p>The default Custom type camera will have the character front and center in the camera, with the crosshair covered by the character.</p></figcaption></figure>

<figure><img src="../../../.gitbook/assets/image (13) (1).png" alt=""><figcaption><p>To work as a TPS shooter, the center of the camera must be angled away from the character.</p></figcaption></figure>



TPS cameras can be easily implemented using the **CameraOffset** property of Camera.

```lua
local Workspace = game:GetService("Workspace")
local Camera = Workspace.CurrentCamera

Camera.CameraOffset = Vector3.new(90, 90, -120)
```
