# World Performance Optimization

## Performance Guide

### Overview &#x20;

Through the Performance Guide feature, key performance indicators such as FPS, Draw Call, and memory usage can be **monitored in real-time within the Studio.**&#x20;

This allows creators to identify performance degradation factors such as frame drops and rendering delays in advance, enabling effective optimization. Ultimately, this ensures overall stability, providing users with a smoother and more enjoyable gameplay experience.



### How to Use

To use the Performance Guide, click the Stat button that appears when you select the Play tab in the top-most tab area of OVERDARE Studio.

<figure><img src="../../../.gitbook/assets/image (141).png" alt=""><figcaption></figcaption></figure>



The Performance Guide is displayed on the Studio’s viewport, allowing you to monitor the real-time changes in performance metrics during test play. This helps you intuitively assess performance changes in various game scenarios, such as player movement, object creation, and effect activation, and use this information for situational optimization.

<figure><img src="../../../.gitbook/assets/image (142).png" alt=""><figcaption></figcaption></figure>

<table><thead><tr><th>Item</th><th width="311.4560546875">Description</th><th>Recommended Value</th></tr></thead><tbody><tr><td>FPS (Frames Per Second)</td><td>The number of frames rendered per second. <br>Higher values provide smoother visuals.</td><td>30 or higher</td></tr><tr><td>CPU Usage</td><td>The percentage of CPU usage. <br>High usage can affect other processes</td><td>70% or lower</td></tr><tr><td>GPU Usage</td><td>The percentage of GPU usage. <br>Affects rendering and graphics processing.</td><td>85% or lower</td></tr><tr><td>Memory Usage</td><td>Total memory usage. <br>Exceeding memory can cause game crashes or performance degradation.</td><td>3GB or lower</td></tr><tr><td>Texture Memory</td><td>The amount of memory used for texture data. <br>Too much can overload the GPU.</td><td>150MB or lower</td></tr><tr><td>Texture Count</td><td>The number of textures in use. <br>More textures increase memory and rendering load.</td><td>200개 or lower</td></tr><tr><td>Mesh Tri Count</td><td>The number of triangles in meshes displayed on screen. <br>Too many can decrease rendering speed.</td><td>300,000 or fewer</td></tr><tr><td>Draw Calls</td><td>The number of commands sent from the CPU to the GPU for rendering. <br>Higher values increase the risk of performance degradation.</td><td>200 or fewe</td></tr><tr><td>Network</td><td>Network traffic and latency. <br>Greatly affects communication responsiveness</td><td>Less than 20KB/s, under 80ms</td></tr></tbody></table>



### Important Notes

* Resources used by the Studio itself are included in the measurements, which may cause a difference in performance compared to actual mobile devices. (In particular, memory usage and rendering performance metrics may appear higher than in mobile environments.)
* When using the multi-test play feature, performance metrics such as CPU, memory, and network usage may be higher compared to single-player. (While this is useful for simulating a multiplayer environment, it should be interpreted separately from single-client performance.)
* GPU usage and FPS values may be affected depending on the viewport resolution settings.
* Performance metrics may also vary due to other background programs running on the PC where the Studio is executed, so it is recommended to keep the testing environment as controlled as possible.



### Usage Examples

* Check to ensure stable FPS, and if frame drops occur in specific areas, examine the calculations, effects, scripts, etc., at those locations to optimize them.
* Monitor CPU and GPU usage to ensure they remain within a certain level. If there is a sudden spike in specific situations, identify the computational load and bottlenecks at those points and improve the processing logic.
* Check if memory usage consistently increases during long test plays. Verify if there are memory leaks or unnecessary objects being retained, and implement cleanup routines (e.g., Destroy(), setting reference variables to nil) to stabilize performance.
* Excessive texture usage can lead to GPU overload or loading delays, so use high-resolution textures only within the necessary range and adjust asset resolutions for optimization.
* If the mesh triangle count for characters or environments is high, the GPU rendering load increases. Simplify meshes that are unnecessarily complex to improve performance.
* If there are too many draw calls, the cost of calls between the CPU and GPU increases. Minimize draw calls by combining object placements or standardizing materials and shaders.
* If network traffic spikes within a short period, it can cause server processing delays or increased latency. Control events that cause excessive packet transmission (e.g., repeated updates, high-frequency position sending) and adjust transmission intervals as needed to optimize traffic.



## World Performance Analytics

### Overview

OVERDARE App allows you to analyze the execution performance of worlds published on the app in **mobile environments**. It helps diagnose performance bottlenecks that occur during gameplay based on key performance indicators such as FPS stability, draw call count, rendering time, and memory usage. You can use this information to optimize your world so that it **runs smoothly even on low-end devices**.

This feature is currently available as an **experimental feature (Experimental)** and will be continuously updated to help creators set more precise performance improvement directions in the future.



### How to Use&#x20;

After entering the world in the OVERDARE app, tap the **chat activation button** in the upper left corner of the screen, then tap the **chat input area (Tap here to chat)**.

<figure><img src="../../../.gitbook/assets/WorldPerformanceProfiling1.png" alt=""><figcaption></figcaption></figure>



Type **profile on** and send the message.

<figure><img src="../../../.gitbook/assets/WorldPerformanceProfiling2.png" alt=""><figcaption></figcaption></figure>



Now, performance information for the world will be displayed in the upper left corner of the screen.

<figure><img src="../../../.gitbook/assets/WorldPerformanceProfiling3.png" alt=""><figcaption></figcaption></figure>

<table><thead><tr><th width="234">Item</th><th>Description</th></tr></thead><tbody><tr><td>FPS (Frames Per Second)</td><td>The number of frames rendered per second. <br>Higher values indicate smoother visuals.</td></tr><tr><td>Frame</td><td>Time it takes to process a single frame (33.33ms = about 30FPS)</td></tr><tr><td>Game</td><td>Time taken to process game logic</td></tr><tr><td>Draw</td><td>Time spent performing draw calls (GPU rendering requests)</td></tr><tr><td>RH</td><td>Time spent on RHI (Render Hardware Interface) tasks</td></tr><tr><td>Draw Calls</td><td>The number of commands sent from the CPU to the GPU for rendering. <br>Higher values may degrade performance.</td></tr><tr><td>Primitives</td><td>Number of basic shapes (triangles, etc.) rendered</td></tr><tr><td>Device Temp</td><td>Current device temperature (for AOS devices)</td></tr><tr><td>Temp Status</td><td>Current device temperature (for iOS devices)</td></tr><tr><td>[OS API] Memory</td><td>To be supported in the future</td></tr><tr><td>[UE] Memory</td><td>Total memory usage</td></tr></tbody></table>



### Usage Examples

By using the world performance analysis feature in the OVERDARE app along with the **Performance Guide**, you can perform more systematic optimization work in the Studio environment.

Based on the performance data collected during world execution such as FPS, draw calls, and RHI processing time, you can identify performance drop-off areas and refer to the recommended values in the Performance Guide to improve the overall content structure, including model composition, lighting usage, and script design.



## Optimization Guide for Low-End Mobile Device

Optimizing for low-end mobile devices is essential to **ensure smooth gameplay across a wide range of hardware performance**. This helps reduce user churn, **expand the potential user base**, and maintain overall stability and consistency in the gameplay experience.

By following the guidelines below, you can ensure a **fair and stable gameplay experience** for 99.9% of OVERDARE users.



### Definition of Low-End Device

In OVERDARE, low-end devices are defined as those equipped with entry-level GPUs such as the PowerVR Rogue GE8320, exemplified by models like the **Galaxy A04e (SM-A042F/DS)**.

If you have a device with a low-end GPU such as the GE8320, we **recommend testing on that device**. It will help verify the game's stability in low-spec environments.



### Optimization Guideline for Low-End Devices

For **static background elements** pre-placed in the world, it is recommended to configure the resource budget as follows:



* Maximum visible vertex count on screen: 70,000 or fewer
  * Prioritize vertex optimization on low-end devices, since **managing vertex count is more critical** than managing tris or primitives.
  * Ideally, **each mesh should be constructed with 700 vertices or fewer**, if possible.
* Maximum visible draw calls on screen: 70 or fewer
* Textures: 100 or fewer (512x512)



Refer to the following criteria for **VFX** such as ParticleEmitter:\


* Maximum visible vertices on screen: 15,000 or fewer
* Maximum visible draw calls on screen: 30 or fewer
