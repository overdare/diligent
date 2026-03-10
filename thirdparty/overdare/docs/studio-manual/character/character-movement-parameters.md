# Character Movement Parameters

## Overview

In OVERDARE, in addition to the default humanoid properties, extended properties are provided to **precisely control the character's handling and movement.**

These features allow creators to tweak the character's movement, jumping, falling, and friction to achieve a handling feel suitable for the game's genre and concept.



## Function Properties

Advanced character control properties can be set on the **Humanoid instance**, and the set values ​​are immediately applied to all characters that contain that humanoid.&#x20;

Some properties can restrict actions when set to 0, which can have various effects depending on the game design, such as disabling jumps, restricting movement, or changing gravity.

<div align="left" data-full-width="false"><figure><img src="../../../.gitbook/assets/StarterPlayer.png" alt=""><figcaption><p>Humanoid-related properties available in StarterPlayer</p></figcaption></figure></div>

<figure><img src="../../../.gitbook/assets/humano.png" alt=""><figcaption><p>Movement parameters available in Humanoid</p></figcaption></figure>



## Category-Specific Extensions

### Movement

Controls the character's base movement speed, direction changes, deceleration, and climbable slope range.

<table><thead><tr><th width="187.166748046875">Property</th><th>Description</th></tr></thead><tbody><tr><td><strong>MaxAcceleration</strong></td><td>The maximum acceleration the character can reach to achieve the target speed</td></tr><tr><td><strong>MaxWalkSpeed</strong></td><td>The maximum speed at which the character can move</td></tr><tr><td><strong>MaxSlopeAngle</strong></td><td>The maximum slope angle the character can climb</td></tr><tr><td><strong>GroundFriction</strong></td><td>The ground friction applied to movement when changing direction or decelerating</td></tr><tr><td><strong>RotationSpeed</strong></td><td>The speed at which the character rotates</td></tr><tr><td><strong>WalkingDeceleration</strong></td><td>The deceleration when stopping in walking/running states</td></tr></tbody></table>



#### Detailed Behavior

* **MaxAcceleration**
  * A larger value makes the character quickly respond, as if springing forward.
  * A smaller value results in slow acceleration, creating movements like heavy robots or tanks.
  * A larger value is appropriate for games that require immediate responsiveness, such as racing or action games, while a lower value is appropriate for games that require a weighty feel, such as RPGs or simulations.
* **WalkingDeceleration**
  * A larger value provides greater braking force, stopping the character almost immediately upon releasing input.
  * A smaller value causes the character to stop gradually due to inertia, allowing for expressions such as skating or sliding.
  * By adjusting this value and GroundFriction together, you can achieve complex handling, such as "strong braking but slippery curves.
* **MaxSlopeAngle**
  * Lowering the value can create a gimmick that restricts access to certain terrain by preventing the character from climbing even slightly sloped terrain.
  * Increasing the value allows the character to climb almost vertical walls, creating unrealistic but unique movements.
* **GroundFriction**
  * A larger value allows the character to reduce speed more quickly during rotation or stopping and sharply turns closer to the spot when turning a curve.
  * A smaller value allows the character to slide longer when stopping and create a wide turning radius due to centrifugal force during curves when turning a curve.
* **RotationSpeed**
  * A larger value enables instant rotation in the input direction, allowing quick responses but potentially feeling mechanical.
  * A smaller value slows direction changes, suitable for weighty transitions or smooth motions.
  * Since the turning feel is determined in combination with GroundFriction, both values can be adjusted to achieve a desired handling feel.



#### Example of Actual Behavior

**\[GroundFriction]**

<div align="left"><figure><img src="../../../.gitbook/assets/GroundFriction.gif" alt="" width="375"><figcaption><p>GroundFriction = 16 (default value)</p></figcaption></figure></div>

<div align="left"><figure><img src="../../../.gitbook/assets/GroundFriction2.gif" alt="" width="375"><figcaption><p>GroundFriction = 1</p></figcaption></figure></div>

**\[RotationSpeed]**

<div align="left"><figure><img src="../../../.gitbook/assets/Animation (1).gif" alt="" width="375"><figcaption><p>RotationSpeed = 3,000 (default value)</p></figcaption></figure></div>

<div align="left"><figure><img src="../../../.gitbook/assets/RotationSpeed2.gif" alt="" width="375"><figcaption><p>RotationSpeed = 300</p></figcaption></figure></div>



### Jump

Controls basic jumps and variations (e.g., consecutive jumps, stomp jump).

<table><thead><tr><th width="187.166748046875">Property</th><th>Description</th></tr></thead><tbody><tr><td><strong>MaxJumpCount</strong></td><td>The maximum number of times the character can jump consecutively</td></tr><tr><td><strong>StompJumpMultiplier</strong></td><td>An auto-bounce ratio applied to the base jump height when stepping on another character</td></tr></tbody></table>



#### Detailed Behavior

* **MaxJumpCount**
  * A value of 1 allows a single jump, while 2 or higher enables double or triple jumps.
  * This can be used to design specific platformers, such as parkour or puzzles, accessible only in specific sections.
* **StompJumpMultiplier**
  * A value of 1 equals the base jump height, while 2 makes the character jump twice as high.
  * This is useful for creating effects such as Super Mario-style “Stomp Jump” or aerial combo actions.



#### Example of Actual Behavior

**\[MaxJumpCount]**

<div align="left"><figure><img src="../../../.gitbook/assets/MaxJumpCount1.gif" alt="" width="375"><figcaption><p>MaxJumpCount = 1 (default value)</p></figcaption></figure></div>

<div align="left"><figure><img src="../../../.gitbook/assets/MaxJumpCount3.gif" alt="" width="375"><figcaption><p>MaxJumpCount = 3</p></figcaption></figure></div>

**\[StompJumpMultiplier]**

<div align="left"><figure><img src="../../../.gitbook/assets/StompJump0.gif" alt="" width="375"><figcaption><p>StompJumpMultiplier = 0 (default value)</p></figcaption></figure></div>

<div align="left"><figure><img src="../../../.gitbook/assets/StompJump0.5.gif" alt="" width="375"><figcaption><p>StompJumpMultiplier = 0.5</p></figcaption></figure></div>



### Fall

Controls the character's aerial movement and how gravity is applied.

<table><thead><tr><th width="210.5001220703125">Property</th><th>Description</th></tr></thead><tbody><tr><td><strong>AirControl</strong></td><td>The degree to which movement input is applied while in the air</td></tr><tr><td><strong>FallingDeceleration</strong></td><td>The amount of deceleration applied when stopping movement input during a fall.</td></tr><tr><td><strong>FallingLateralFriction</strong></td><td>The friction force for horizontal movement of the character in the air</td></tr><tr><td><strong>GravityScale</strong></td><td>The ratio of gravity applied to the character</td></tr></tbody></table>



**Detailed Behavior**

* **AirControl**
  * A value of 0 prevents direction changes after jumping, while 1 allows free direction changes as if moving on the ground.
  * High values are used in platform action games, while low values are appropriate for realistic falling.
* **FallingDeceleration**
  * A larger value results in a quicker stop and easier aerial control.
  * A smaller value increases inertia, causing the character to keep sliding.
* **FallingLateralFriction**
  * A larger value results in faster and more stable direction changes.
  * A smaller value causes the previous movement to persist even when changing direction, making the motion look slippery.
* **GravityScale**
  * A larger value makes the character fall heavier and faster.
  * A negative value pulls the character upward (+Z), creating an anti-gravity effect.



#### Example of Actual Behavior

**\[FallingDeceleration]**

<div align="left"><figure><img src="../../../.gitbook/assets/FallingDecel.gif" alt="" width="375"><figcaption><p>FallingDeceleration = 2,500 (default value)</p></figcaption></figure></div>

<div align="left"><figure><img src="../../../.gitbook/assets/FallingDecel250.gif" alt="" width="375"><figcaption><p>FallingDeceleration = 250</p></figcaption></figure></div>

**\[FallingLateralFriction]**

<div align="left"><figure><img src="../../../.gitbook/assets/FallingLateral0.gif" alt="" width="375"><figcaption><p>FallingLateralFriction = 16 (default value)</p></figcaption></figure></div>

<div align="left"><figure><img src="../../../.gitbook/assets/FallingLateral0.2.gif" alt="" width="375"><figcaption><p>FallingLateralFriction = 8</p></figcaption></figure></div>



### Character Collision and Mesh Adjustment

Adjusts the character's collision body size and mesh position to ensure accurate detection.

<table><thead><tr><th width="187.166748046875">Property</th><th>Description</th></tr></thead><tbody><tr><td><strong>CapsuleHeight</strong></td><td>The vertical height of the character's collider capsule</td></tr><tr><td><strong>CapsuleRadius</strong></td><td>The horizontal radius of the character's collider capsule</td></tr><tr><td><strong>CharacterMeshPos</strong></td><td>The interpolation of the relative position between the character mesh and the collider capsule</td></tr></tbody></table>



**Detailed Behavior**

* **CapsuleHeight**
  * A larger value makes the character register as taller, while a smaller value makes it register as shorter, like a dwarf.
* **CapsuleRadius**
  * A smaller value lets the character pass through tight corridors or door gaps, while a larger value causes easier collisions and makes the body appear larger.
* **CharacterMeshPos**
  * This is used to fix issues such as feet floating or sticking into the ground.
  * This must be adjusted when applying a custom avatar or skin.



#### Example of Actual Behavior

**\[CharacterHeight & CharacterMeshPos]**

<div align="left"><figure><img src="../../../.gitbook/assets/CharacterCollision.gif" alt="" width="375"><figcaption><p>CapsuleHeight = 164, CharacterMeshPos = Vector3.new(0,-85, 0)</p></figcaption></figure></div>

<div align="left"><figure><img src="../../../.gitbook/assets/CharacterCollision2.gif" alt="" width="375"><figcaption><p>CapsuleHeight = 82, CharacterMeshPos = Vector3.new(0, -42.5, 0)</p></figcaption></figure></div>



### Environmental Interaction

Controls how the character interacts with platforms or movable objects.

<table><thead><tr><th width="187.166748046875">Property</th><th>Description</th></tr></thead><tbody><tr><td><strong>IgnoreBaseRotation</strong></td><td>Sets whether the character is affected by platform rotation</td></tr></tbody></table>



**Detailed Behavior**

* **IgnoreBaseRotation**
  * Determines whether the character follows the rotation of a moving platform when standing on it.
    * True: The character remains fixed in place without rotating, even when standing on a rotating platform. This allows the character to look stably standing on the surface.
    * False: The character rotates with the platform, and the camera viewpoint rotates along with it.



#### Example of Actual Behavior

**\[IgnoreBaseRotation]**

<div align="left"><figure><img src="../../../.gitbook/assets/Ignorebase.gif" alt="" width="375"><figcaption><p>IgnoreBaseRotation = true (default value)</p></figcaption></figure></div>

<div align="left"><figure><img src="../../../.gitbook/assets/Ignorebasen.gif" alt="" width="375"><figcaption><p>IgnoreBaseRotation = false</p></figcaption></figure></div>



### Camera Controls

Interpolates the rotation and tracking movements of the camera for smooth expression.

<table><thead><tr><th width="213.83349609375">Property</th><th>Description</th></tr></thead><tbody><tr><td><strong>EnableSmoothFollow</strong></td><td>Enables the camera to follow the character's movements smoothly.</td></tr><tr><td><strong>SmoothFollowSpeed</strong></td><td>The speed at which the camera follows the character's movements</td></tr><tr><td><strong>FollowMaxDistance</strong></td><td>The maximum lag distance allowed when the camera follows the character</td></tr><tr><td><strong>EnableSmoothRotation</strong></td><td>Enable the camera to follow the character's rotation smoothly</td></tr><tr><td><strong>SmoothRotationSpeed</strong></td><td>The speed at which the camera responds to the character's rotation</td></tr></tbody></table>



**Detailed Behavior**

* **EnableSmoothFollow**
  * Sets the camera to track the character's movements smoothly instead of instantly.
    * True: The camera follows but lags behind slightly, providing a smooth and natural view.
    * False: The camera always follows the character instantly, which may be fast but rather mechanical.
* **SmoothFollowSpeed**
  * A higher value means light and quick responses, giving an immediate sense of play.
  * A smaller value causes the camera to follow slowly, creating a cinematic effect.
* **FollowMaxDistance**
  * A larger value may cause the camera to lag further behind but not beyond the threshold.
  * A smaller value causes the camera to stick close to the character when following it.
* **EnableSmoothRotation**
  * Sets the camera to follow character rotation smoothly instead of instantly.
    * True: Rotates at a steady speed, providing smooth and stable movement.
    * False: Instantly rotates to the character's input direction, which is fast but may feel rigid.
* **SmoothRotationSpeed**
  * A larger value means a quicker response, which is close to an instantaneous transition.
  * A smaller value makes the camera to follow slower, allowing for a more relaxed turning motion.



#### Example of Actual Behavior

**\[SmoothFollow]**

<div align="left"><figure><img src="../../../.gitbook/assets/Rundefault.gif" alt="" width="375"><figcaption><p>EnableSmoothFollow = true (default value), WalkSpeed = 1,000<br>SmoothFollowSpeed = 5, FollowMaxDistance = 250</p></figcaption></figure></div>

<div align="left"><figure><img src="../../../.gitbook/assets/SmootFollow.gif" alt="" width="375"><figcaption><p>EnableSmoothFollow = false, WalkSpeed = 1,000</p></figcaption></figure></div>

**\[SmoothRotation]**

<div align="left"><figure><img src="../../../.gitbook/assets/SmoothRotation00.gif" alt="" width="375"><figcaption><p>EnableSmoothRotation = false (default value)</p></figcaption></figure></div>

<div align="left"><figure><img src="../../../.gitbook/assets/SmoothRotation.gif" alt="" width="375"><figcaption><p>EnableSmoothRotation = true, SmoothRotationSpeed = 5</p></figcaption></figure></div>



## Note

If the value is unusually large or small, it may result in unrealistic handling.
