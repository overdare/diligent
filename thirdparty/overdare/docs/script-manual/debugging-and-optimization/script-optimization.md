# Practical Guide to Script Optimization

## Overview

In large-scale RPGs or action games with complex systems, how scripts are designed and executed can significantly impact overall game performance. Poorly optimized scripts can lead to critical issues such as **server crashes**, **client frame drops**, **memory leaks**, or **unexpected errors**. These problems can **negatively affect** **player retention** and **revenue**.

This document explains the **fundamental principles of scripts** and introduces various **performance optimization techniques** that can be applied in real scenarios. It aims to help maintain stable performance and deliver a smooth gameplay experience even under complex logic, large numbers of objects, or frequent communication processing.



## Important Notes

Scripts should be **written with a balance between optimization and code readability**. Over-optimizing for performance can make the code difficult to understand, while excessive abstraction or overly verbose structures can negatively impact performance.



## Script Execution Fundamentals

To write optimized code, it is important to have a deep understanding of how Lua operates at a fundamental level. Knowing how it handles execution, memory management, and data processing helps reduce resource waste and prevent performance bottlenecks.



### Variable Types&#x20;

In Lua, the behavior of a variable depends on whether it holds a **Value Type** or a **Reference Type**.

<table><thead><tr><th width="209.00006103515625">Type</th><th width="137.7720947265625">Examples</th><th>Characteristics</th></tr></thead><tbody><tr><td>Value Type</td><td>number<br>string<br>boolean<br>nil</td><td><ul><li><strong>Copied</strong> on assignment</li></ul></td></tr><tr><td>Reference Type</td><td><strong>table</strong><br><strong>function</strong><br><strong>coroutine</strong><br><strong>Instance</strong></td><td><ul><li><strong>Reference shared</strong> on assignment</li></ul><ul><li>Since it is a reference and not a copy, changing the value in one will affect the other</li></ul></td></tr></tbody></table>



Reference types store a reference (address) to the data rather than the actual value itself. This means multiple variables can share the same reference. As a result, modifying the value through one variable will affect all other variables that point to the same reference. While this allows for flexible data structures, it also increases the risk of unintended side effects or bugs, so caution is advised.

```lua
local t1 = { score = 100 }
local t2 = t1     -- Reference is shared

t2.score = 200    -- Also affects t1

print(t1.score)   -- Output: 200
print(t2.score)   -- Output: 200
```



### Memory Structure&#x20;

Internally, Lua uses a **stack** and **heap** memory structure to manage variables. Depending on the variable’s type, the storage location, lifetime, and garbage collection behavior can differ.

<table><thead><tr><th width="194.96484375">Type</th><th width="128.631591796875">Save Location</th><th>Features</th></tr></thead><tbody><tr><td>Value Type</td><td><strong>Stack</strong></td><td><ul><li><strong>Lifetime:</strong> Valid during the execution of a function or block, automatically destroyed when the scope is exited</li><li><strong>Memory Release:</strong> No explicit cleanup is needed, and is automatically removed according to the execution flow</li></ul></td></tr><tr><td>Reference Type</td><td><strong>Heap</strong></td><td><ul><li><strong>Lifetime:</strong> Remains as long as there is a reference to the object; stays in memory as long as at least one reference exists</li></ul><ul><li><strong>Memory Release:</strong> Removed by GC once all references are disconnected</li><li><strong>Features:</strong> A single object can be referenced by multiple variables, offering flexibility, but requires careful memory management</li></ul></td></tr></tbody></table>



Value types are automatically released from memory when they go out of scope. In contrast, reference types are periodically cleaned up by the GC depending on whether they are still being referenced. If unused references are not explicitly cleared, reference types can lead to memory leaks and performance degradation.



However, even for reference types, **if they are only used within the scope and are no longer referenced elsewhere**, they will automatically be eligible for GC and released from memory. But in structures where references are maintained, such as global variables, closures, or circular references between tables, explicit reference removal is required.

```lua
do
    local t = { 1, 2, 3 } 
    print(t[1])           
end
-- Here, t is no longer referenced as it is out of scope 
-- It will be automatically released from memory according to the next GC cycle
```



### GC (Garbage Collection)

Lua uses a **Mark-and-Sweep** style **Garbage Collection (GC)** system for automatic memory management. GC automatically detects objects that are no longer in use and reclaims their memory, so unlike in languages like C++, developers do not need to manually allocate or free memory.

In other words, while Lua handles most of the memory management for you, **it’s important to structure your code and manage access patterns in a way that avoids leaving behind unnecessary references for GC to work efficiently.** As long as a reference to an object remains, Lua considers it “in use” and will not collect it. If you don’t carefully design when and how references are released, memory leaks can occur.



**Mark-and-Sweep**

1. **Mark phase:** Starting from root objects such as global variables, local variables, and the call stack of active functions, the GC traverses all reachable objects and marks those that are still being referenced
2. **Sweep phase:** Objects that were not marked—meaning they are no longer referenced from anywhere—are freed (collected) from memory.



**Conditions for Memory Release**

* Objects with no remaining references
* Objects that have been destroyed via Destroy() and whose references have been set to nil
* Event connection objects that have been disconnected using Disconnect() and whose references have also been cleared to nil



### Why Understanding GC Matters <a href="#why-understanding-gc-matters" id="why-understanding-gc-matters"></a>

Understanding how GC works goes far beyond the idea that “it is convenient because it automatically cleans up memory.” It has real implications for performance, stability, and maintainability.



* GC automatically manages memory, but **it will never collect an object that still has a reference**.
* Explicitly removing GC-eligible objects reduces unnecessary memory usage and helps **keep memory consumption predictable**.
* The more heap objects exist, the more frequently GC is triggered, which can cause frame drops.
* It is important to reduce GC occurrence itself by **avoiding repetitive object creation and deletion and using reuse strategies such as pooling.**
* It helps you **quickly diagnose and fix issues** such as “Why isn’t memory usage going down after Destroy()?” or “Why is the game getting slower over time?”

&#x20;

## Basic Optimization Guidelines

### Performance Optimization

* **Use object pooling instead of creating/destroying instances at runtime** with Instance.new() or Clone()\
  (e.g. instead of creating a new bullet each time with Instance.new(), reuse pre-made objects and store them again after use)
* Avoid the structure of creating/destroying a large number of objects all at once\
  (e.g. rather than spawning 50 monsters simultaneously, spread them out over time to reduce lag)
* Always call **Destroy() and set references to nil** for unused objects
* Always call **Disconnect() and set references to nil** for unused event connections
* In particular, events tied to players and characters must be explicitly disconnected
* Hide unused UI elements from the screen
* **Cache and reuse frequently used references** for objects, services, and instances\
  (e.g. instead of calling game:GetService(“Players”) each time, store it in a variable and reuse it)
* **Cache and reuse** the result of require() when using ModuleScripts
* Avoid using global variables and keep your data scoped locally\
  (e.g. avoid using global variables such as myData, which can affect the entire script)
* Remove any variables that are no longer used
* Precompute and cache values like Vector3 or CFrame\
  (e.g. for fixed values like projectile offsets, calculate them once during initialization instead of recalculating them every time)
* **Design with one-way references** instead of complex circular dependencies (where objects reference each other)\
  (e.g. instead of having the character and the weapon reference each other, have only the weapon reference the character)
* Design your code to reuse tables whenever possible\
  (e.g. instead of creating a new table on each loop iteration, reuse a table declared outside the loop to save memory)
* Avoid overusing **anonymous functions** and minimize the use of unnecessary closures\
  (especially avoid defining a new function inside a for loop just to connect an event each time)
* Use index rather than key to process simple tables\
  (In tables like { “a”, “b”, “c” }, ipairs iterates faster than pairs)
* Use the \* operator if division can be replaced with multiplication\
  (e.g. x \* 0.5 is faster than x / 2)
* For long string concatenations, use \*\*table.concat()\*\* instead of “a” … “b” to improve performance\
  (The … operator allocates new memory for each concatenation, so frequent use can increase GC load)
* Design for, while, and other loops to run conditionally or intermittently, rather than executing them unconditionally\
  (in particular, adjust the loop interval)
* Avoid processing large workloads all at once, and instead use coroutines or chunking to spread the load
* Avoid creating excessive coroutines, and reuse existing ones or set them to nil after they’re finished
* Use frame-based events like Heartbeat only when necessary, and make sure to disconnect them once they’re no longer needed



### Network and Event Optimization

* Handle any logic that can be processed on the client side to minimize server load
* Use RemoteEvent communication only when necessary, and **consolidate similar actions under a single RemoteEvent**\
  (batch frequent calls together before sending)
* Design to minimize **data transfer** as much as possible\
  (e.g. for height data, send a number instead of the full Vector3)
* Use Attribute for passing attributes\
  (performance impact ranking: RemoteEvent > ValueInstance > Attribute)
* Implement a priority queue for network communication to distinguish between critical and optional updates, allowing for more efficient processing\
  (effects and sounds should be processed with lower priority)
* Design your system using an event-driven architecture so that data is processed only when needed
* In situations where events are triggered too frequently, design the system to use get functions instead
* APIs that rely on server communication such as DataStore have rate limits, so design your system to throttle calls per minute accordingly



### Architecture Design

* When handling multiple objects with identical behavior such as multiple KillPart instances, manage them through a single **manager script** rather than attaching individual scripts to each object
* Apply architectural patterns like **MVC** to reduce code dependencies and minimize duplication across your project\
  (e.g. clearly separate responsibilities so that UI updates only when needed, reducing unnecessary processing overhead)
* Use **state machines** for game logic, monsters, etc. to ensure that only the relevant logic is executed and computed at any given time
* Clearly separate data processing and visualization responsibilities to server and client to distribute workload and avoid performance bottlenecks



## High-Priority Performance Optimization Strategies

These strategies are relatively easy to implement and can significantly reduce major issues such as **lag, memory leaks, and overall performance instability.**



### Destroy + nil Cleanup

Explicitly remove references to unused objects to ensure they are collected by GC.

```lua
local Effect = Instance.new("ParticleEmitter")
...
Effect.Parent = Part

wait(3)
Effect:Destroy()  -- Destroy the object
Effect = nil      -- Remove the reference (eligible for GC)
```



### Event Disconnect + nil Cleanup

Unused events must also have their references explicitly removed. This is especially important for events tied to players or characters.

```lua
local Connection = nil

local function OnDied()
    if Connection then
        Connection:Disconnect()  -- Disconnect the event
        Connection = nil         -- Remove the reference (eligible for GC)
    end
end
Connection = Humanoid.Died:Connect(OnDied)
```



### Object Pooling

Instead of repeatedly creating and destroying objects, build a reusable structure to efficiently recycle items such as bullets, effects, and UI slots.

This approach reduces unnecessary memory allocation and deallocation, minimizing GC overhead and helping prevent frame drops or temporary lag spikes.

```lua
local BulletManager = {}

-- Pool to store bullet objects
local PoolList = {}

-- Create bullet template object
local template = Instance.new("Part")
template.Size = Vector3.new(0.2, 0.2, 2)
...
template.Name = "Bullet"

-- Create a specified number of bullets and store them in the pool
function BulletManager:Init(count)
    for i = 1, count do
        local bullet = template:Clone()
        ...
        bullet:SetAttribute("Active", false)

        table.insert(PoolList, bullet)
    end
end

-- Return an available bullet from the pool
function BulletManager:GetFromPool()
    for _, bullet in ipairs(PoolList) do
        if not bullet:GetAttribute("Active") then
            bullet:SetAttribute("Active", true)
            ...

            return bullet
        end
    end
    return nil
end

-- Return a used bullet back to the pool
function BulletManager:Release(bullet)
    bullet:SetAttribute("Active", false)
    ...
end

return BulletManager
```

```lua
local PoolCount = 30 -- Maximum number of reusable objects
BulletManager:Init(PoolCount) -- Initialize the bullet pool and create the objects in advance

local Bullet = BulletManager:GetFromPool() -- Get an available object from the pool

if Bullet then
    Bullet.Position = startPos
    ...

    wait(1)
    BulletManager:Release(Bullet) -- Return the bullet back to the pool for reuse.
end
```



## Usage Examples

This manual is not just a document listing rules to memorize. It serves as a **‘benchmark’** that can be flexibly referenced and applied **based on the project’s nature, structural complexity, and performance requirements.**



* **When implementing new features,** use this as a checklist to consider how the structure and flow of processes might impact performance in advance.
* **If performance issues are suspected during debugging,** quickly review this section to identify potential areas for improvement.
* **In collaborative environments,** this can serve as a foundational document to ensure consistency in coding styles and optimization practices among team members.



**It’s not necessary to enforce every item.** However, keep in mind that the guidelines in this document are intended to help prevent common issues that will inevitably arise as your project grows.
