# Animation Editor

## Overview <a href="#overview" id="overview"></a>

<figure><img src="../../../.gitbook/assets/image (122) (1).png" alt=""><figcaption></figcaption></figure>

The **Animation Editor** is a powerful tool that allows you to create and edit animations based on the ODA (OVERDARE Deformable Avatar) standard for avatars.



## Features

Through the built-in Animation Editor in the Studio, you can create animations directly within the Studio workflow without the need for external programs. Additionally, you can easily import and edit FBX animation files created externally.



* You can precisely edit animations on a keyframe basis in the **timeline**, and make real-time edits and previews of the animation in the **preview panel**.
* You can import **FBX** animation files created externally.
* You can **register the created animation on the server** and load animation files stored on the server for use.
* You can set **animation events** to integrate with the necessary processing in scripts.



## Displaying Animation Editor <a href="#how-to-use" id="how-to-use"></a>

The Animation Editor can be displayed by clicking the **Animation Editor** **button** that appears when you select the **Model tab** in the top-most tab area of OVERDARE Studio.

<figure><img src="../../../.gitbook/assets/AnimEditor1.png" alt=""><figcaption></figcaption></figure>



## Screen Layout

The Animation Editor screen is structured as follows:

<figure><img src="../../../.gitbook/assets/AniEditorLayout.png" alt=""><figcaption></figcaption></figure>

* **Toolbar**: Allows you to save or load animations and change the editing mode of the preview panel.
* **Rig Hierarchy**: Displays the avatar’s bone structure.
* **Preview Panel**: Shows the animation corresponding to the current position on the timeline.
* **Keyframe Editor**: Enables precise editing of animations based on the timeline.



## How to Use

### Toolbar Functions <a href="#toolbar-functions" id="toolbar-functions"></a>

<figure><img src="../../../.gitbook/assets/image (123).png" alt=""><figcaption></figcaption></figure>

<table><thead><tr><th width="221.017578125">Function</th><th>Description</th></tr></thead><tbody><tr><td><strong>Save</strong></td><td>Saves the current animation being worked on.<br>(Internally saved in the current PC's Studio, not on the map.)</td></tr><tr><td><strong>Save As</strong></td><td>Saves the current animation under a different name.</td></tr><tr><td><strong>Load</strong></td><td>Loads a previously saved animation.</td></tr><tr><td><strong>Import</strong></td><td><ul><li><strong>Import from OVERDARE:</strong> Loads your animation registered on the server.</li><li><strong>Import from FBX:</strong> Imports an animation from an FBX file.</li></ul></td></tr><tr><td><strong>Get Asset Id</strong></td><td><strong>Registers the current animation on the server</strong> and generates an Asset Id.</td></tr><tr><td><strong>Create New</strong></td><td>Creates a new animation.</td></tr><tr><td><strong>Select</strong></td><td>Changes the preview panel's editing mode to <strong>Select Mode</strong>.</td></tr><tr><td><strong>Move</strong></td><td>Changes the preview panel's editing mode to <strong>Move Mode</strong>.<br>(Click on the bones in the preview panel to move them.)</td></tr><tr><td><strong>Rotate</strong></td><td>Changes the preview panel's editing mode to <strong>Rotate Mode</strong>.<br>(Click on the bones in the preview panel to rotate them.)</td></tr></tbody></table>



By pressing the displayed button, you can change the reference point for editing coordinate axis of the selected bone to either World or Local.

<div align="left"><figure><img src="../../../.gitbook/assets/image (144).png" alt=""><figcaption></figcaption></figure></div>



### Rig Hierarchy Panel <a href="#rig-hierarchy-panel" id="rig-hierarchy-panel"></a>

he Rig Hierarchy panel displays the avatar’s skeletal structure. When you click on a bone in the Rig Hierarchy, the corresponding bone is also selected in the Preview Panel.

<div align="left"><figure><img src="../../../.gitbook/assets/image (124).png" alt=""><figcaption></figcaption></figure></div>



### Preview Panel <a href="#preview-panel" id="preview-panel"></a>

The **Preview Panel** shows the animation corresponding to the current position on the timeline.

<figure><img src="../../../.gitbook/assets/AniEditorPreview.png" alt=""><figcaption></figcaption></figure>



After selecting a bone in the Preview Panel, set the editing mode to **Move** or **Rotate** to edit the selected bone using the Gizmo axis.\
(If there is no keyframe at the current position on the timeline, a keyframe will be automatically created when manipulating the Gizmo.)

<figure><img src="../../../.gitbook/assets/image (130).png" alt=""><figcaption></figcaption></figure>



You can use the **Show toggle** to control the visibility of the background and floor.

<figure><img src="../../../.gitbook/assets/image (131).png" alt=""><figcaption></figcaption></figure>



### Keyframe Editor <a href="#keyframe-editor" id="keyframe-editor"></a>

In the Timeline, you can add or remove **tracks** for each bone and precisely edit the position and rotation information of each bone on a keyframe basis.

<figure><img src="../../../.gitbook/assets/image (132).png" alt=""><figcaption></figcaption></figure>



By clicking the **Add Track button**, you can add or remove **tracks** for each bone.

<figure><img src="../../../.gitbook/assets/image (133).png" alt=""><figcaption></figcaption></figure>



The **Timeline** is the workspace where you can edit the keyframes of the animation over time.

<figure><img src="../../../.gitbook/assets/AniEditorTimeline1.png" alt=""><figcaption></figcaption></figure>



You can adjust the range of the timeline workspace by directly entering the desired frame values in the Start/End input fields.

<figure><img src="../../../.gitbook/assets/image (134).png" alt=""><figcaption></figcaption></figure>



The **Scrubber** is a vertical line on the timeline that allows you to select the time position. You can **drag the timeline ruler** to move the scrubber’s position.

<figure><img src="../../../.gitbook/assets/AnimEditorGIF1.gif" alt=""><figcaption></figcaption></figure>



By pressing the **Options button**, you can move the scrubber to the beginning or end of the timeline. The Playback Speed option allows you to adjust the playback speed of the animation.

<figure><img src="../../../.gitbook/assets/AniEditorTimeline3.png" alt=""><figcaption></figcaption></figure>



In the **Playback Control** area, you can use functions such as play, reverse play, jump to a specific frame, and set loop options for the animation.

<figure><img src="../../../.gitbook/assets/AniEditorTimeline4.png" alt=""><figcaption></figcaption></figure>



**Right-clicking a keyframe** on the timeline opens a menu where you can reset or delete animation information. Additionally, you can set the **Interpolation** to Linear, Constant, or Cubic to control how the keyframes are interpolated.

<figure><img src="../../../.gitbook/assets/image (135).png" alt=""><figcaption></figcaption></figure>

* **Reset Keyframes:** Resets the animation information of the keyframe.
* **Delete Keyframes:** Deletes the selected keyframe.
* **Copy Keyframes**: Copies the keyframe.
* **Set Interpolation:** Sets the interpolation method for the keyframe.



**Right-clicking on an empty screen** in the timeline with no keyframes opens a menu that allows you to delete frames from specific sections or add new frames at your desired position.

<figure><img src="../../../.gitbook/assets/image (136).png" alt=""><figcaption></figcaption></figure>

* **Remove frame n to n**: Deletes keyframes between frames n to n.
* **Insert frame before n**: Adds a keyframe before frame n.
* **Insert frame after n**: Adds a keyframe after frame n.
* **Append at Beginning**: Adds a keyframe before the specified frame.
* **Append at End**: Adds a keyframe after the specified frame.
* **Add All Keyframe Here**: Adds the same keyframe as the previous one at the current position.
* **Add Reset Keyframe Here**: Adds a keyframe with reset animation information at the specified position.
* **Paste Keyframes:** Pastes the copied keyframe at the current position.



### Animation Events <a href="#animation-events" id="animation-events"></a>

By clicking the **Add Events button**, you can add animation events, allowing **interaction with scripts** at specific frames of the animation.

<figure><img src="../../../.gitbook/assets/AnimEditor2.png" alt=""><figcaption></figcaption></figure>

* The registered events are displayed as markers on the **Animation Event Bar** in the timeline.
* By right-clicking the registered event, you can **Rename Event, Copy, or Delete** it.



The added animation events can be handled as follows:

<pre class="language-lua"><code class="lang-lua">local Players = game:GetService("Players")
<strong>local LocalPlayer = Players.LocalPlayer
</strong><strong>
</strong>local character = LocalPlayer.Character
local humanoid = character:WaitForChild("Humanoid")

local animation = Instance.new("Animation")
animation.AnimationId = "ovdrassetid://1234"

local animator = humanoid:FindFirstChild("Animator")
local animationTrack = animator:LoadAnimation(animation)

local function OnAnimationEvent()
    print("OnAnimationEvent")
end
animationTrack:GetMarkerReachedSignal("SomeKeyName"):connect(OnAnimationEvent)

animationTrack:Play()
</code></pre>



## Keyboard Shortcuts <a href="#keyboard-shortcuts" id="keyboard-shortcuts"></a>

| Shortcut                                               | Action                                        |
| ------------------------------------------------------ | --------------------------------------------- |
| **(When clicking the preview panel) Arrow keys**       | Move the camera                               |
| **(When a bone is selected) F**                        | Move the camera to focus on the selected bone |
| **Shift+Click on Bone**                                | Multi-select bones                            |
| **Ctrl+1**                                             | Select Tool                                   |
| **Ctrl+2**                                             | Move Tool                                     |
| **Ctrl+3**                                             | Rotate Tool                                   |
| **Ctrl+S**                                             | Save animation                                |
| **Spacebar**                                           | Play / Pause animation                        |
| **Ctrl+Z / Ctrl+Y**                                    | Undo / Redo                                   |
| **(When a keyframe is selected) Ctrl+C / Ctrl+V**      | Copy / Paste keyframe                         |
| **(When a keyframe is selected) Delete**               | Delete the keyframe                           |
| **(When a keyframe is selected) Shift + Click + Drag** | Duplicate the keyframe                        |
| **Ctrl+Mouse Wheel Up/Down**                           | Zoom in/out of the timeline area              |



## How to Register and Use Animations

To register the created animation, click the **Get Asset Id button** to register it on the server.

<figure><img src="../../../.gitbook/assets/image (137).png" alt=""><figcaption></figcaption></figure>



Once the animation is successfully registered on the server, an **Asset Id** will be generated. Click the button indicated in the image to **copy the Asset Id**.

<figure><img src="../../../.gitbook/assets/image (138).png" alt=""><figcaption></figcaption></figure>



To use the animation, it **must be placed** in the Level Browser. Add the **animation** to ServerStorage.

<div align="left"><figure><img src="../../../.gitbook/assets/image (139).png" alt=""><figcaption></figcaption></figure></div>



Select the added animation and paste the copied **Asset Id** into the **Animation Id** field in the Properties window.

<figure><img src="../../../.gitbook/assets/image (140).png" alt=""><figcaption></figcaption></figure>



## Important Notes

* When you **Save** the animation you’re working on, it is **saved in OVERDARE Studio**, not the map.
* Therefore, if you open the map on a different PC, the animation you’re working on will not be visible.
* Animations registered in OVERDARE can be imported back using the **Import from OVERDARE** option.
* If any data is modified **after the animation is registered**, you must **re-register it, generate a new Asset Id, and link it** to reflect the changes.
