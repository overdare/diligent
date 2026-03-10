# Asset Import

## Overview <a href="#overview" id="overview"></a>

World assets created in OVERDARE Studio can be registered in the [Creator Hub](https://eterno-studio-fgt.ovdr.io/). Depending on the public settings, registered assets can be freely used by anyone in the Asset Drawer of OVERDARE Studio.

Import 3D models created in external tools like Blender or 3D Max, audio such as background music, or UI images—any assets necessary for world creation.



## Types of Importable Assets <a href="#types-of-importable-assets" id="types-of-importable-assets"></a>

<table><thead><tr><th>Asset Type</th><th width="613">Supported Extensions</th></tr></thead><tbody><tr><td>Texture</td><td>.png / .tga (Max size: 15MB)</td></tr><tr><td>Mesh</td><td>.fbx / .obj (Max triangles: 30,000, Max size: 250MB)</td></tr><tr><td>Audio</td><td>.wav / .mp3 / .ogg (Max size: 20MB)</td></tr></tbody></table>



## Asset Creation Guidelines

### Mesh

* Recommended vertex count per prop for low-spec devices: 700 or less
* Total vertex limit for the screen: 70,000 or less



Learn More (Optimization Guide for Low-End Mobile Device)

{% content-ref url="../game-development/world-performance-profiling.md" %}
[world-performance-profiling.md](../game-development/world-performance-profiling.md)
{% endcontent-ref %}



### Texture

* Default recommended resolution: 512 × 512
* For ultra-low-spec devices: A resolution of 256 or lower recommended



## Mesh Creation Guideline <a href="#mesh-creation-guideline" id="mesh-creation-guideline"></a>

### Generating Colliders <a href="#generating-colliders" id="generating-colliders"></a>

When a mesh is imported into OVERDARE Studio, a collider is automatically generated based on the mesh’s structure. If the system determines that the mesh can be enclosed in a convex (outwardly protruding) shape without issues, the collider will be created using the following method.



**Default Creation Method**

* **Up to 32 convexes per mesh**
* Each convex only includes **up to 32 vertices**
* If the mesh structure can be enclosed within a convex shape, **a collider is generated based on 1,024 total vertices** (up to 32 convex shapes x 32 vertices per convex).
  * The maximum number of vertices that are converted into colliders is 1,024. If this limit is exceeded, automatic collision generation may become abnormal.



**While this method is beneficial in terms of performance, it may also lead to the following issues.**

* The collider may appear to **float in the air** due to a mismatch with the mesh structure, or it may become **damaged** or **penetrated**.
* There may be slight inaccuracies, such as the collider floating in the air or penetrating through the mesh.



**Conditions for skipping convex creation and using the mesh as a collider**

* When the mesh has a non-uniform or uneven structure (e.g., irregular shape instead of a flat shape)
* When the mesh requires too many convex shapes (e.g., if the number of convex vertices exceeds the number of mesh vertices)
* When it is beneficial to use the mesh structure directly as a collider



Currently, the automatic collider generation function prioritizes speed over precision to create a general collision area rather than matching the mesh shape exactly. For content or scenarios where collision accuracy is critical, it is recommended to manually define the collider.



**Tips**

* If the collision is complex or requires detailed accuracy, it is recommended to manually create the collider.
* If you choose to use the mesh structure as the collider, be sure not to exceed the maximum vertex limit.
* For more accurate collision detection, manually setting the collider may be preferable to using a convex-based method.



### Using a Collision Mesh (UCX) <a href="#using-a-collision-mesh-ucx" id="using-a-collision-mesh-ucx"></a>

After creating a **mesh for collisions** in a 3D modeling software like Blender or 3ds Max, save the mesh with the name format “**UCX\_meshname**.” Meshes with the “UCX\_” prefix will **automatically be recognized as colliders** when imported into OVERDARE Studio.

Use this function to use separate **collision meshes** independently from complex mesh shapes.

(However, collision meshes must have a fully closed shape. If any side is open, the collision will not be processed correctly.)

<figure><img src="../../../.gitbook/assets/ucx.png" alt=""><figcaption></figcaption></figure>



## Importing Assets <a href="#importing-assets-1" id="importing-assets-1"></a>

### How to Import Assets <a href="#how-to-import-assets" id="how-to-import-assets"></a>

In OVERDARE Studio, you can load a world, then import the assets you want to use in that world.

In OVERDARE Studio, select the **Home tab** in the top tab area, then click the **Import button** or **BulkImport button** to import assets.

<figure><img src="../../../.gitbook/assets/asset-import-1.png" alt=""><figcaption></figcaption></figure>



Alternatively, you can also click the **Import button** in the **Asset Manager** panel.

<figure><img src="../../../.gitbook/assets/image (12).png" alt=""><figcaption></figcaption></figure>

* **Import3D Button**: Allows importing a single asset. (Detailed options can be set when importing a mesh.)
* **BulkImport Button** or **Import Button**: Allows importing multiple assets. (Simplified options can be set when importing a mesh.)



For importing character animations, refer to the Characters manual.

{% content-ref url="../character/" %}
[character](../character/)
{% endcontent-ref %}



### Mesh Import Options <a href="#mesh-import-options" id="mesh-import-options"></a>

<figure><img src="../../../.gitbook/assets/Import-Preview.png" alt=""><figcaption></figcaption></figure>



#### **File General**

<table><thead><tr><th width="145">Category</th><th width="332">Description</th><th>Default</th></tr></thead><tbody><tr><td>Name</td><td>Displays the name of the imported 3D asset. You can change the name to make it visible in the project.</td><td><br></td></tr><tr><td>Import Only as Model</td><td>When enabled, the model is imported as a single asset even if it contains multiple child objects.<br>If disabled, the model and its child meshes are imported as separate assets.</td><td>Enabled by default.</td></tr><tr><td>Insert in Workspace</td><td>When enabled, the imported 3D asset is inserted into the Workspace and Asset Drawer.<br>If disabled, it is only inserted into the Toolbox and Asset Manager.</td><td>Enabled by default.</td></tr><tr><td>Insert Using Scene Position</td><td>When enabled, the model is inserted into the Workspace using the current scene position.</td><td>Disabled by default.</td></tr><tr><td>Set Model Instance Pivot to Scene Origin</td><td>When enabled, the Pivot point of the entire model is set to the Scene Origin.</td><td>Enabled by default.</td></tr></tbody></table>



#### **File Transform**

<table><thead><tr><th width="145">Category</th><th>Description</th><th>Default</th></tr></thead><tbody><tr><td>World Forward</td><td>Sets the axis that faces forward for the object. Can be set to Front, Back, Left, or Right.</td><td>Front</td></tr><tr><td>World Up</td><td>Sets the axis that faces upward for the object. Can be set to Top, Bottom, Left, or Right.</td><td>Top</td></tr></tbody></table>



#### **File Geometry**

<table><thead><tr><th width="145">Category</th><th>Description</th><th>Default</th></tr></thead><tbody><tr><td>Scale Unit</td><td>Sets the unit used for modeling the file to ensure proper scaling. Options: Stud, Meter, CM, MM, Foot, Inch.</td><td>CM</td></tr><tr><td>Merge Meshes</td><td>If enabled, all MeshParts in the model are merged into a single MeshPart that is not a model.</td><td>Disabled by default.</td></tr><tr><td>Invert Negative Faces</td><td>Reverses the direction of negative faces in the mesh.</td><td>Disabled by default.</td></tr></tbody></table>



#### **Object Geometry**

<table><thead><tr><th width="145">Category</th><th>Description</th><th>Default</th></tr></thead><tbody><tr><td>Make Double Sided</td><td><ul><li>If disabled, vertices are single-sided, meaning they are visible only from one direction.</li></ul><ul><li>If enabled, they are double-sided and visible from both directions.</li></ul></td><td>Disabled by default.</td></tr><tr><td>Ignore Vertex Colors</td><td>When enabled, vertex color data of child objects is ignored.</td><td>Disabled by default.</td></tr></tbody></table>



### Important Notes <a href="#important-notes" id="important-notes"></a>

If imported assets are not registered in OVERDARE, **only the creator who created the world can use them**. When the map file is shared with another creator, it may not function properly for them.

Therefore, **if multiple creators need to work on the same map file**, make sure to register the imported assets in OVERDARE.



### Automatic Texture Linking for Imported Meshes

When you export a **textured mesh** from a 3D modeling program such as 3ds Max or Blender, and then import it using the **Import button** in the Home tab of the top menu in OVERDARE Studio, the model will be imported with linked textures if **Import Only as Model is disabled**.

(Note: When using Bulk Import or the Import button in the Asset Manager, textures will not be linked even if Import Only as Model is disabled.)



## Registering in OVERDARE <a href="#registering-in-overdare" id="registering-in-overdare"></a>

### How to Register <a href="#how-to-register" id="how-to-register"></a>

Select the world asset you want to register in the **Level Browser**, then right-click and choose **Save to OVERDARE** to register the asset in the Creator Hub.

<figure><img src="../../../.gitbook/assets/asset-import-2.png" alt=""><figcaption></figcaption></figure>



Clicking Save to OVERDARE will **automatically redirect you to a web page** where you can input asset information such as tags and public settings.\
(All information must be filled out to register the asset.)

<figure><img src="../../../.gitbook/assets/image (14).png" alt=""><figcaption></figcaption></figure>



Review the terms and conditions, click agree, and click Complete to finish registration.

<figure><img src="../../../.gitbook/assets/image (90).png" alt=""><figcaption></figcaption></figure>



Registered assets can be viewed in the **Asset Drawer** within OVERDARE Studio. Assets with public settings can be used by other creators.



### Finding My Assets in the Creator Hub <a href="#finding-my-assets-in-the-creator-hub" id="finding-my-assets-in-the-creator-hub"></a>

Go to the Dashboard by clicking Dashboard - My Contents in the top menu area of the [Creator Hub](https://create.overdare.com/).

<figure><img src="../../../.gitbook/assets/image (101).png" alt=""><figcaption></figcaption></figure>



Click the **World Asset tab** in the Dashboard to view all registered assets.

<figure><img src="../../../.gitbook/assets/image (15).png" alt=""><figcaption></figcaption></figure>



### Distribution Settings <a href="#distribution-settings" id="distribution-settings"></a>

On the world asset editing page, use the **Distribute on Asset Store** option to make the asset available in OVERDARE Studio’s Asset Drawer panel.\
(Enabling Distribute allows other creators to use the asset.)

<figure><img src="../../../.gitbook/assets/image (16).png" alt=""><figcaption></figcaption></figure>



## Placing Assets <a href="#placing-assets" id="placing-assets"></a>

In the Asset Manager, select the category of the asset you want to place.

<figure><img src="../../../.gitbook/assets/image (17).png" alt=""><figcaption></figcaption></figure>



Locate the asset you want to place.

<figure><img src="../../../.gitbook/assets/image (18).png" alt=""><figcaption></figcaption></figure>



Double-click the asset or drag and drop it into the Viewport to place it in the Workspace.

<figure><img src="../../../.gitbook/assets/image (19).png" alt=""><figcaption></figcaption></figure>



## Linking Asset Ids <a href="#linking-asset-ids" id="linking-asset-ids"></a>

Some objects **reference assets** for display. For example, MeshPart objects reference meshes, MeshPart or VFX reference textures, and Sound objects reference audio. In such cases, you must link the **Asset Id of the asset to be displayed** to the object.



### Properties Requiring Asset Ids <a href="#properties-requiring-asset-ids" id="properties-requiring-asset-ids"></a>

<table><thead><tr><th width="182">Field</th><th>Related Object</th></tr></thead><tbody><tr><td>Mesh Id</td><td>MeshPart, CharacterMesh, etc.</td></tr><tr><td>Texture Id</td><td>MeshPart, BackpackItem, VFX, etc.</td></tr><tr><td>Sound Id</td><td>Sound</td></tr><tr><td>Image</td><td>ImageButton, ImageLabel, etc.</td></tr></tbody></table>



### How to Link an Asset Id <a href="#how-to-link-an-asset-id" id="how-to-link-an-asset-id"></a>

Select the object and check the properties window for fields requiring Asset Ids (e.g., Mesh Id, Texture Id).

<figure><img src="../../../.gitbook/assets/image (20).png" alt=""><figcaption></figcaption></figure>



Copy the Asset Id by right-clicking the asset in the **Asset Manager** and selecting **Copy Asset Id to Clipboard**.

<figure><img src="../../../.gitbook/assets/image (21).png" alt=""><figcaption></figcaption></figure>



Alternatively, hover over the asset in the **Asset Drawer**, click the **magnifying glass button (🔍)**, and click the **copy button** next to the Asset Id.

<figure><img src="../../../.gitbook/assets/image (22).png" alt=""><figcaption></figcaption></figure>



The copied Asset Id must be set in the format **ovdrassetid://number**.\
(Example: ovdrassetid://**1234**)

<figure><img src="../../../.gitbook/assets/image (23).png" alt=""><figcaption></figcaption></figure>



## Precautions When Using Asset Ids in Scripts

Asset Ids can also be assigned in scripts as shown below:

```lua
local Worksapce = game:GetService("Workspace")
local Sound = Worksapce.Sound

Sound.SoundId = "ovdrassetid://1234"
```



When used as shown, scripts, meshes, textures, sounds, and animations that are **imported directly** can be used without having to be placed in the Level Browser.

However, **assets imported from the Asset Drawer** must be placed in the Level Browser to be used in the script. (If they are not placed in the Level Browser, **they will not load on mobile**, even though they may load correctly in the Studio.)
