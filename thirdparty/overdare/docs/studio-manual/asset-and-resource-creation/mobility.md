# Mobility Settings

## Overview

The Mobility option categorizes instances placed in the world as either **Static** or **Movable** to support performance optimization.

The rendering and update methods vary depending on the changeable nature of each instance, reducing unnecessary computations to achieve stable performance.



## Comparison of Options

### **Static**

* Ideal for objects that do not change in position, rotation, or scale
* Processes with minimal computation by utilizing precomputed data (e.g., lightmaps).
* Cannot be moved, rotated, or scaled at runtime.



### **Movable**

* Ideal for objects that need translation, rotation, animation, or player interaction
* Computes state changes every frame to provide dynamic presentation and interactivity
* Recommended for core gameplay elements or objects where expression is important, as it comes with performance costs



## How to Use

After **placing an instance in the Workspace**, in the `Property > Mobility` option, select either Static or Movable.

<figure><img src="../../../.gitbook/assets/image (2) (1).png" alt=""><figcaption></figcaption></figure>



Mobility can only be changed for the **highest level (direct child) instances in the Workspace**.



### Static Recommended For

* **Recommended Examples**: Buildings, terrain, interior structures, rocks, trees, background props, etc.
* **Reason for Recommendation**:&#x20;
  * Since their position or scale never changes during gameplay, setting these to Static allows for the **precalculation of lighting and computations**, minimizing unnecessary waste of resource.&#x20;
  * Since static objects place a lower burden on GPU/CPU, stable performance can be maintained even in large maps or with many objects.
* **Important Notes**:
  * As objects set to Static cannot be moved or controlled at runtime, they should only be used for **background elements not directly associated with gameplay**.



### Movable Recommended For

* **Recommended Examples**: Characters, equipment items, vehicles, moving platforms, movable objects, gimmick objects directly interacted with by players, etc.
* **Reason for Recommendation**:&#x20;
  * Movable seamlessly works with movement, rotation, and animation, making it ideal for expression of **core dynamic elements of gameplay**.&#x20;
  * Objects that are directly manipulated by players or that need to physically react must be set to Movable to show dynamic changes.
* **Important Notes**:&#x20;
  * Since Movable calculates changes at each frame, it incurs higher performance costs than Static, and setting too many objects as Movable in one scene may cause performance degradation.&#x20;
  * Therefore, it is recommended to limit Movable to **key interactive objects** and avoid using it for unnecessary elements.



## Important Notes When Using It

### Restrictions on Hierarchy of Static Instances

* Since Static is defined as non-movable instances, **they cannot be placed as children of a Movable instance.**
* OVERDARE Studio has a structure where child instances follow the movement of their parent. Therefore, if a Static instance follows its parent’s movement, it causes a problem of violating its own definition.
* To prevent this issue, the editor **restricts placing Static under Movable**.
* At runtime, if you attempt to place a Static instance under a Movable instance, it will **trigger an error**.



### Restrictions on Changes and Creation

* The Mobility of instances outside the Workspace cannot be changed.
* The Mobility option cannot be changed at runtime.
* Static instances cannot be dynamically created or duplicated at runtime.
* Static instances do not support direct or indirect position changes, such as changing `CFrame` or disabling the `Anchored` property.
