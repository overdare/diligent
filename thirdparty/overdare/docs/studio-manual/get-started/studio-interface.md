# Studio Interface

## Overview <a href="#overview" id="overview"></a>

Creators can use OVERDARE Studio to design in-game objects (world assets), build game maps (worlds), and craft **their own unique gaming environments**. Designed for accessibility, it enables both beginners and experts to create engaging and creative games with ease.



## OVERDARE Studio Basic Layout <a href="#overdare-studio-basic-layout" id="overdare-studio-basic-layout"></a>

### Viewport <a href="#viewport" id="viewport"></a>

Located in the Workspace, the Viewport displays objects placed in the world. It allows users to manipulate the position, rotation, and scale of selected objects.

<figure><img src="../../../.gitbook/assets/Studio-Interface-New-Viewport.png" alt=""><figcaption></figcaption></figure>



#### **Camera Controls**

<table><thead><tr><th width="196">Keys</th><th>Action</th></tr></thead><tbody><tr><td>W, A, S, D</td><td><strong>Click on the Viewport</strong> and press W/A/S/D, or <strong>hold the right mouse button</strong> while pressing W/A/S/D to move the camera forward, left, backward, or right.</td></tr><tr><td>Q, E</td><td><strong>Click on the Viewport</strong> and press Q/E, or <strong>hold the right mouse button</strong> while pressing Q/E to move the camera down or up.</td></tr><tr><td>Shift</td><td>Hold Shift along with movement keys (W, A, S, D) to adjust the camera movement speed.</td></tr><tr><td>F</td><td>Focus the camera on the selected object.</td></tr><tr><td>Right Mouse Button</td><td><strong>Hold the right mouse button</strong> and move the mouse to rotate the camera.</td></tr><tr><td>Mouse Wheel Up/Down</td><td>Zoom in and out by moving the <strong>mouse wheel up or down</strong>.</td></tr><tr><td>Mouse Wheel Button</td><td><strong>Hold the mouse wheel button</strong> and move the mouse to pan the camera.</td></tr></tbody></table>



#### **Selecting Objects**

Hover over an object in the Viewport to highlight it with a blue outline. Click the highlighted object to select it.

<figure><img src="../../../.gitbook/assets/image (25).png" alt=""><figcaption></figcaption></figure>

<figure><img src="../../../.gitbook/assets/image (26).png" alt=""><figcaption></figcaption></figure>



Hold Shift while clicking to select multiple objects. Hold Ctrl + Shift while clicking to deselect objects.



### Level Browser <a href="#level-browser" id="level-browser"></a>

The Level Browser displays objects placed in the world, such as Parts, Models, and Scripts, and allows you to add or delete objects.

<figure><img src="../../../.gitbook/assets/Studio-Interface-New-LevelBrowser.png" alt=""><figcaption></figcaption></figure>



#### **Adding Objects**

Hover over the location in the Level Browser where you want to add an object, then click the **+ button** to add a new object.

<figure><img src="../../../.gitbook/assets/studio-interface-3.png" alt=""><figcaption></figcaption></figure>



#### **Editing Objects**

Right-click an object to access options like copy, paste, and delete.

<figure><img src="../../../.gitbook/assets/studio-interface-4.png" alt=""><figcaption></figcaption></figure>



### Properties <a href="#properties" id="properties"></a>

Select an object in the Level Browser or Viewport to view or edit its properties in the Properties window.

<figure><img src="../../../.gitbook/assets/Studio-Interface-New-Properties.png" alt=""><figcaption></figcaption></figure>



#### **Copying/Editing Properties**

Right-clicking a property value brings up a menu with options to copy or paste values.

<figure><img src="../../../.gitbook/assets/studio-interface-6.png" alt=""><figcaption></figcaption></figure>



### Asset Drawer <a href="#asset-drawer" id="asset-drawer"></a>

Use assets like models, images, meshes, and audio registered by other creators.

<figure><img src="../../../.gitbook/assets/Studio-Interface-New-AssetDrawer.png" alt=""><figcaption></figcaption></figure>



#### Asset Manager <a href="#asset-manager" id="asset-manager"></a>

Import assets like models, images, meshes, and audio into the world, view the list of imported assets, and insert them into the world.

<figure><img src="../../../.gitbook/assets/Studio-Interface-New-AssetManager.png" alt=""><figcaption></figcaption></figure>



For more details on importing assets, refer to the manual below:

{% content-ref url="../asset-and-resource-creation/asset-import.md" %}
[asset-import.md](../asset-and-resource-creation/asset-import.md)
{% endcontent-ref %}



### Toolbar <a href="#toolbar" id="toolbar"></a>

The Toolbar is located at the top of OVERDARE Studio and consists of the Home, Model, Script, and View tabs.

<figure><img src="../../../.gitbook/assets/studio-interface-9.png" alt=""><figcaption></figcaption></figure>

* Home tab: Provides basic tools for manipulating 3D objects and testing the created world.
* Model tab: Offers tools for manipulating 3D objects in the workspace, setting detailed materials and colors for objects, and adjusting Parts and collision settings.
* Script tab: Provides various features for controlling, testing, and debugging scripts within the project.
* View tab: Allows you to configure multiple windows and display settings within OVERDARE Studio.



## Toolbar <a href="#toolbar-1" id="toolbar-1"></a>

### Home Tab <a href="#home-tab" id="home-tab"></a>

<figure><img src="../../../.gitbook/assets/studio-nav-1.png" alt=""><figcaption></figcaption></figure>



* Select, move, resize, and rotate objects in the Viewport.\
  ![](../../../.gitbook/assets/studio-nav-hometab-1.png)

| Select Tool (Ctrl+1)                                                            | Move Tool (Ctrl+2)                                                              | Scale Tool (Ctrl+3)                                                             | Rotate Tool (Ctrl+4)                                                            |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| <img src="../../../.gitbook/assets/image (27).png" alt="" data-size="original"> | <img src="../../../.gitbook/assets/image (28).png" alt="" data-size="original"> | <img src="../../../.gitbook/assets/image (29).png" alt="" data-size="original"> | <img src="../../../.gitbook/assets/image (30).png" alt="" data-size="original"> |
| Object selection mode                                                           | Position editing mode                                                           | Size editing mode                                                               | Rotation editing mode                                                           |



* Collision: Set whether objects like Parts or MeshParts collide or pass through other colliders by editing in the Viewport with Move/Scale/Rotate Tools.\
  <img src="../../../.gitbook/assets/studio-nav-hometab-2.png" alt="" data-size="original">



* Create Parts, characters, or Rig Builders.\
  ![](../../../.gitbook/assets/studio-nav-hometab-3.png)



* Import: Insert external assets such as meshes, images, and audio into the world. Use Import to select a single file or Bulk Import to select multiple files.\
  ![](../../../.gitbook/assets/studio-nav-hometab-4.png)



* Apply Group, Lock, or Anchor to selected objects.\
  ![](../../../.gitbook/assets/studio-nav-hometab-5.png)
  * Group: Group selected objects into a Model or Folder.
  * Lock: Prevent selected objects from being selected in the Viewport.
  * Anchor: Set whether selected objects are physically anchored.



* Adds a script.\
  ![](../../../.gitbook/assets/studio-nav-hometab-8.png)



* Play the world in single or multiplayer test mode.\
  ![](../../../.gitbook/assets/studio-nav-hometab-6.png)



* Provides UI-related features.\
  ![](../../../.gitbook/assets/studio-nav-hometab-7.png)
  * UI Mode: Displays UI objects placed in StarterGui in the Viewport.
  * Resolution: Change the Viewport resolution.



* Provide a graphics quality setting that matches the visual output of the mobile environment.\
  ![](../../../.gitbook/assets/studio-nav-hometab-9.png)



### Model Tab <a href="#model-tab" id="model-tab"></a>

<figure><img src="../../../.gitbook/assets/studio-interface-10.png" alt=""><figcaption></figcaption></figure>



* Same functionality as the Home Tab.\
  ![](../../../.gitbook/assets/studio-nav-modeltab-1.png)



* Collision: Same functionality as the Collision Section in the Home Tab.\
  ![](../../../.gitbook/assets/studio-nav-hometab-2.png)



* Set the editing unit for moving, scaling, or rotating objects in the Viewport.\
  ![](../../../.gitbook/assets/studio-nav-modeltab-3.png)



* Import external assets, change the color of selected Parts, or manage materials.\
  ![](../../../.gitbook/assets/studio-nav-modeltab-4.png)
  * Color: Change the color of selected objects if applicable.
  * Material Manager: Add, edit, or apply materials.



* Same functionality as the Home Tab.\
  ![](../../../.gitbook/assets/studio-nav-hometab-5.png)



* Align: Align selected objects.\
  ![](../../../.gitbook/assets/studio-nav-modeltab-5.png)



* Provides the ability to add or configure collision groups.\
  ![](../../../.gitbook/assets/studio-nav-modeltab-6.png)



### Play Tab <a href="#play-tab" id="play-tab"></a>

<figure><img src="../../../.gitbook/assets/studio-nav-3.png" alt=""><figcaption></figcaption></figure>

Same functionality as the Play Section in the Home Tab.



### Script Tab <a href="#script-tab" id="script-tab"></a>

<figure><img src="../../../.gitbook/assets/studio-interface-12.png" alt=""><figcaption></figcaption></figure>



* Find / Replace: Find and replace text in the script editor. This feature can be used in a single script or across all scripts.\
  ![](../../../.gitbook/assets/studio-nav-scripttab-1.png)



* Same functionality as the Home Tab.\
  ![](../../../.gitbook/assets/studio-nav-scripttab-2.png)



* When a breakpoint is hit, the script executes the code line.\
  ![](../../../.gitbook/assets/studio-nav-scripttab-3.png)
  * Step Into: Enter the **function** on the current line and continue debugging.
  * Step Over: Execute the function on the current line **without entering it, then move to the next line**.
  * Step Out: Execute the rest of the current function and return to the **parent function**.



* Same functionality as the Home Tab.\
  ![](../../../.gitbook/assets/studio-nav-hometab-8.png)



### View Tab <a href="#view-tab" id="view-tab"></a>

<figure><img src="../../../.gitbook/assets/studio-nav-5.png" alt=""><figcaption></figcaption></figure>

*   Show or hide specific panels.

    <figure><img src="../../../.gitbook/assets/studio-nav-viewtab-1.png" alt=""><figcaption></figcaption></figure>



* Display the Grid, Wireframe, and Collision in the Viewport.\
  ![](<../../../.gitbook/assets/studio-nav-viewtab-2 (1).png>)\




* Same functionality as the Home Tab.\
  ![](../../../.gitbook/assets/studio-nav-viewtab-3.png)



## Keyboard Shortcuts <a href="#keyboard-shortcuts" id="keyboard-shortcuts"></a>

<table><thead><tr><th width="214">Shortcut</th><th>Function</th></tr></thead><tbody><tr><td>Ctrl + 1</td><td>Select Tool</td></tr><tr><td>Ctrl + 2</td><td>Move Tool</td></tr><tr><td>Ctrl + 3</td><td>Scale Tool</td></tr><tr><td>Ctrl + 4</td><td>Rotate Tool</td></tr><tr><td>Spacebar</td><td>Switch tools in the order of Move - Scale - Rotate.</td></tr><tr><td>Ctrl + C</td><td>Copy the selected object to clipboard.</td></tr><tr><td>Ctrl + V</td><td>Insert the object saved to clipboard.</td></tr><tr><td>Ctrl + Shift + V</td><td>Insert the object saved to clipboard under the selected object.</td></tr><tr><td>Ctrl + X</td><td>Cut the currently selected object to the clipboard.</td></tr><tr><td>Ctrl + D</td><td>Duplicate the currently selected object.</td></tr><tr><td>F1</td><td>Go to the OVERDARE Creator Guide page.</td></tr><tr><td>F2</td><td>Change the name of the selected object.</td></tr><tr><td>F5</td><td>Run the play test.</td></tr><tr><td>Shift + F5</td><td>End the play test.</td></tr><tr><td>F11</td><td>Toggle viewport panel to fullscreen.</td></tr><tr><td>Ctrl + S</td><td>Save in OVERDARE.</td></tr><tr><td>Ctrl + Shift + S</td><td>Save as a new local file.</td></tr><tr><td>Ctrl + N</td><td>Generate a new project.</td></tr><tr><td>Ctrl + O</td><td>Open the project as a local file.</td></tr><tr><td>Ctrl + Shift + O</td><td>Open the project in OVERDARE.</td></tr><tr><td>Alt + P</td><td>Publish the project in OVERDARE.</td></tr><tr><td>Alt + Shift + P</td><td>Newly publish the project in OVERDARE.</td></tr><tr><td>Ctrl + F4</td><td>Close the current project.</td></tr><tr><td>Alt + X</td><td>Switch the display state of the level browser panel.</td></tr><tr><td>Ctrl + Shift + F1</td><td>Switch the display state of the profiler (Stats).</td></tr><tr><td>Alt + L</td><td>Switch the Locked state of the selected Part.</td></tr><tr><td>Alt + A</td><td>Switch the Anchored state of the selected Part.<br>(If Model is selected, switch the Anchored state of every descendant Part.)</td></tr><tr><td>Ctrl + G</td><td>Group the selected objects into a model.</td></tr><tr><td>Ctrl + Alt + G</td><td>Group the selected objects into a folder.</td></tr><tr><td>Ctrl + U</td><td>Ungroup the selected folder/model.</td></tr><tr><td>Ctrl + L</td><td>Switch the Gizmo axis between Local/World.</td></tr><tr><td>Ctrl + R</td><td>Switch the horizontal rotation axis (y-axis).</td></tr><tr><td>Ctrl + T</td><td>Switch the vertical rotation axis (x-axis).</td></tr><tr><td>Ctrl + I</td><td>Show the Add Objects menu.</td></tr><tr><td>Ctrl + Shift + X</td><td>Enter the filter entry mode for level browser panel.</td></tr><tr><td>Ctrl + Shift + P</td><td>Enter the filter entry mode for property panel.</td></tr><tr><td>G</td><td>Switch the display state of the gizmo and grid.</td></tr></tbody></table>



## Output Panel <a href="#output-panel" id="output-panel"></a>

### Output Log <a href="#output-log" id="output-log"></a>

Displays information, warnings, and errors occurring in the world and scripts.

![](../../../.gitbook/assets/StudioManual-Readme-Output_Log.png)



### Problems <a href="#problems" id="problems"></a>

Displays error information in the script in real time.

![](../../../.gitbook/assets/StudioManual-Readme-Problems.png)



## Breakpoint Management Panel <a href="#breakpoint-management-panel" id="breakpoint-management-panel"></a>

### Breakpoints <a href="#breakpoints" id="breakpoints"></a>

You can view the list of breakpoints set in the script. Breakpoints can be enabled or disabled from the list, and double-clicking the Script or Line column will navigate to the corresponding code line.

![](../../../.gitbook/assets/StudioManual-Readme-Breakpoints.png)



### Watch <a href="#watch" id="watch"></a>

You can check the state of variables when a breakpoint is hit.

<figure><img src="../../../.gitbook/assets/image (107).png" alt=""><figcaption></figcaption></figure>



#### Call Stack <a href="#call-stack" id="call-stack"></a>

You can track the order of function calls when a breakpoint is hit.

<figure><img src="../../../.gitbook/assets/image (108).png" alt=""><figcaption></figcaption></figure>



For more details on breakpoints, you can refer to the manual below.

{% content-ref url="../../script-manual/debugging-and-optimization/breakpoint.md" %}
[breakpoint.md](../../script-manual/debugging-and-optimization/breakpoint.md)
{% endcontent-ref %}
