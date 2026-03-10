# Part

## Overview <a href="#overview" id="overview"></a>

<figure><img src="../../../.gitbook/assets/image (109).png" alt=""><figcaption></figcaption></figure>

A Part is the most fundamental element that makes up the world of OVERDARE. All visual objects placed in the world consist of **Parts** and **MeshParts**. A Part defines the appearance of an object through various properties such as position, rotation, size, color, and texture, and it can also define physical properties such as gravity, friction, and collision.

Parts are world objects provided in basic shapes such as cubes, spheres, and cylinders. Creators can use these basic shapes to construct and arrange models.



## Properties <a href="#properties" id="properties"></a>

Part properties are broadly categorized into three types.



### Appearance <a href="#appearance" id="appearance"></a>

* CastShadow: Determines whether the Part casts a shadow.
* Shape: Sets the basic shape of the Part (e.g., box, sphere, cylinder).
* Color: Sets the color of the Part.
* Material: Defines the surface texture of the Part (e.g., plastic, metal).
* Transparency: Adjusts the transparency of the Part.



### Transform <a href="#transform" id="transform"></a>

* CFrame
  * Position: Defines the Part’s world coordinates.
  * Orientation: Sets the rotation direction of the Part.
* Size: Adjusts the size of the Part.



### Physical Properties <a href="#physical-properties" id="physical-properties"></a>

* Anchored: Fixes the Part in place to prevent movement.
* CanCollide: Determines whether the Part collides with other objects.
* Massless: Specifies whether the Part’s mass is ignored in physics simulations.



### Other Properties

* CanClimb: Enables Climbing when turned on. When CanClimb is turned on, the character will switch to a Climbing state upon contact, allowing them to scale the wall surface of the Part.



## Relationship Between CFrame, Origin, and Pivot <a href="#relationship-between-cframe-origin-and-pivot" id="relationship-between-cframe-origin-and-pivot"></a>

### CFrame <a href="#cframe" id="cframe"></a>

* CFrame stands for **Coordinate Frame** and is a data type that includes an object’s **position** and **orientation** information.
* CFrame is used to position or rotate objects in 3D space. For example, it can place an object at a specific location while orienting it in a certain direction.
* **CFrame.Position** extracts only the position of an object from CFrame and is represented as a Vector3 data type.
* CFrame has the following characteristics:
  * Can handle both position and orientation simultaneously.
  * Allows an object to face a specific direction.
    * Example: `CFrame.new(startPosition, targetPosition)`
  * Efficient in terms of performance and suitable for various mathematical operations (e.g. applying offsets and linear interpolation.)



### Origin <a href="#origin" id="origin"></a>

* Origin represents the **pivot point** of an object, serving as its default rotation center.
* Origin exists separately from CFrame and is mainly used to adjust or reference the pivot position of a Model or Part.
* The Origin information can be manipulated using the **PivotTo()** function or the **GetPivot()** function. These functions allow adjusting an object’s position and rotation based on its pivot point.
* Origin has the following characteristics:
  * The pivot point may not always be the object’s center (it can be manually set).
  * Useful for moving or rotating all objects under a parent Model.
  * Cannot be directly modified via scripts but can be adjusted indirectly using functions like **PivotTo()**.



## Adding and Modifying Parts <a href="#adding-and-modifying-parts" id="adding-and-modifying-parts"></a>

In OVERDARE Studio, Parts can be added by clicking the **Home - Add button** and selecting the desired shape.

<figure><img src="../../../.gitbook/assets/part-1.png" alt=""><figcaption></figcaption></figure>



A placed Part can have its shape easily changed without being deleted by modifying the **Shape property** in the Properties window.

<figure><img src="../../../.gitbook/assets/image (110).png" alt=""><figcaption></figcaption></figure>



## Part's CanClimb Option <a href="#part-canclimb" id="part-canclimb"></a>

The CanClimb option allows you to explicitly designate a Part as an Object that allows Climbing.&#x20;

When a character comes into contact with a Part that has CanClimb enabled, they enter a Climbing state and can scale the wall.&#x20;

However, even if CanClimb is enabled, the character will not enter the Climbing state if the slope of the wall they're facing is less than the MaxSlopeAngle defined in GameSettings. Instead, they'll walk or run along the inclined wall.&#x20;

If you modify the CanClimb option using a LocalScript, the change only applies to that specific Client and will not Replicate to the server or other players. This can be used to allow only certain players to scale walls.&#x20;

If the CanClimb option is changed on the server, the updated Climb state is Replicated to all clients, allowing every player to see the change.

