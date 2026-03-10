# Studio Play Test

## Overview <a href="#overview" id="overview"></a>

In OVERDARE Studio, you can test and verify the functionality of placed objects or scripts using the **Play** feature. This allows you to check your work in real-time and quickly identify any necessary adjustments.

## Important Notes <a href="#important-notes" id="important-notes"></a>

The environment in which users play published games is **mobile**, not the PC used for OVERDARE Studio. Therefore, elements related to mobile devices, such as controls and UI, must be **tested and finalized on a mobile device**. For mobile testing, refer to **Item #5** in the Publishing Worlds Manual.

{% content-ref url="world-publish.md" %}
[world-publish.md](world-publish.md)
{% endcontent-ref %}

## How to Use

### Play Feature Location <a href="#play-feature-location" id="play-feature-location"></a>

The Play feature is available in the **Home tab** in the top tab area of OVERDARE Studio.

<figure><img src="../../../.gitbook/assets/studio-testplay-1.png" alt=""><figcaption></figcaption></figure>

By selecting the **Play tab** in the tab area, you can display features only related to Play.

<figure><img src="../../../.gitbook/assets/studio-testplay-2.png" alt=""><figcaption></figcaption></figure>

### Play, Pause, and Stop <a href="#play-pause-and-stop" id="play-pause-and-stop"></a>

Click the **Play button (or press F5)** to start the game.

While in Play mode, click the **Pause button** to temporarily pause the game. Click the **Stop button (or press Shift+F5)** to end the game and return to the editing screen.

<figure><img src="../../../.gitbook/assets/test-play-3.png" alt=""><figcaption></figcaption></figure>

### Test Option Settings <a href="#test-option-settings" id="test-option-settings"></a>

In the **Play tab**, click the arrow (🔽) next to the Stop button to configure test options.

<figure><img src="../../../.gitbook/assets/test-play-4.png" alt=""><figcaption></figcaption></figure>

<table><thead><tr><th width="240">Option</th><th>Description</th></tr></thead><tbody><tr><td>Number of Players</td><td>Sets the number of players that will join when the game is launched<br>(For testing multiplayer environments).</td></tr></tbody></table>

### Add a Client

Press the **Add a Client button** during a play test to add a new player.

<figure><img src="../../../.gitbook/assets/image (1).png" alt=""><figcaption></figcaption></figure>

When you click the Close (X) button on the client window, only the corresponding client process is terminated, while the server and other clients continue running. This allows you to test player disconnection scenarios without restarting the entire session.

### Enter Spectator Mode

You can switch to Spectator Mode by pressing the Spectator View button while in Play mode.

In the spectator mode, you can detach from the player character and observe the game **from a free camera perspective**. Press the Player View button again to return to the player’s perspective.

(However, spectator mode cannot be used during multi-test.)

<figure><img src="../../../.gitbook/assets/rhkswjswk.png" alt=""><figcaption></figcaption></figure>

## Virtual Emulation Test of Mobile Environment

In the Studio, a mobile device environment can be emulated virtually for testing, allowing you to preview how system UI, joysticks, jump buttons, and GUIs appear in an actual mobile environment.

### Function Location

The Device Emulation function can be enabled or disabled by clicking **Device Emulation** in the **Play tab** on the top tab area of ​​OVERDARE Studio.

<figure><img src="../../../.gitbook/assets/Device-Emulator1.png" alt=""><figcaption></figcaption></figure>

### Device Emulation Mode

When Device Emulation is enabled, the viewport automatically adjusts to the resolution of the selected device.

<figure><img src="../../../.gitbook/assets/Device-Emulator2-2.png" alt=""><figcaption></figcaption></figure>

* 1️⃣ Select Device: Select the device to simulate. You can choose a predefined device or add a new one.
* 2️⃣ Select Resolution Scaling Method: Set how the viewport screen matches the actual device's size.
  * Physical Scale: Displays the same size as the actual device, reflecting the pixel density (DPI) of the actual device.
  * Actual Resolution: Displays pixels as they are, regardless of dot per inch (DPI).
  * Fit to Window: Displays the current viewport screen to its full size.
* 3️⃣ Show SafeArea Region: If the selected device has a SafeArea such as a notch or punch hole, the region is displayed.

When you run a play test with Device Emulation enabled, the viewport displays the system UI, joystick, and jump button.

In normal play mode, the camera can be rotated with left and right mouse clicks, but in Device Emulation mode, rotation is possible only with **left-click**.

<figure><img src="../../../.gitbook/assets/Device-Emulator3.png" alt=""><figcaption></figcaption></figure>

* 1️⃣ Show System UI Region
* 2️⃣ Show SafeArea Region
* 3️⃣ Joystick Region
* 4️⃣ Jump Button

Unlike the joystick and jump button, the buttons in the System UI region do not work when clicked; they are simply displayed as images only.

### Memory Usage Display and Warning

If the selected device's memory limit exceeds, the memory usage at the top of the viewport is displayed in orange, and a warning is output to the Output Log.

However, the memory usage is not measured from an actual device but is estimated through a simple ratio calculation based on the size of resources (e.g., textures, sounds, meshes) included in the project. Therefore, differences may occur compared to the actual memory consumed on a device due to memory management for each device.

<figure><img src="../../../.gitbook/assets/Device-Emulator4-1.png" alt=""><figcaption></figcaption></figure>

### Adding a New Device

Click **Manage Devices** in the device selection dropdown menu to open the Emulation Device Manager window, where a new device can be added.

When creating a device, sequential names from newDevice0 to newDevice9 are assigned by default, allowing up to 10 devices. However, **renaming allows unlimited addition** of devices.

<figure><img src="../../../.gitbook/assets/Device-Emulator5-1.png" alt=""><figcaption></figcaption></figure>

<figure><img src="../../../.gitbook/assets/Device-Emulator6-1.png" alt=""><figcaption></figcaption></figure>

* 1️⃣ Registered devices are displayed.
* 2️⃣ Can set the device specifications of the selected device.
* 3️⃣ Can add or delete new devices or duplicate registered devices.
  * Name: Name of the device
  * Device Platform: OS type of the device (has no functional impact, used for differentiation)
  * Physical X: Horizontal resolution of the screen (in pixels)
  * Physical Y: Vertical resolution of the screen (in pixels)
  * PPI: Pixel density of the screen (Pixels Per Inch)
  * Memory: Device memory capacity (in MB)
* 4️⃣ Saves the entered device information.

The added device information is saved as a JSON file in the path below:

`C:\Program Files\Epic Games\OverdareStudioPJVXb\Sandbox\EditorResource\Sandbox\DeviceSpecs_Custom`

## Network StressTest

Press the **Network StressTest** button to simulate and test real-world network overload conditions such as packet delay and packet loss.

<figure><img src="../../../.gitbook/assets/image (2).png" alt=""><figcaption></figcaption></figure>

* EnableTest : Toggles the network stress testing feature on or off. When enabled, the options below will be applied.
* Packet Lag Minimum : Sets the **minimum packet delay** in milliseconds (ms). Can be used together with Packet Lag Maximum to simulate a random delay range.
* Packet Lah Maximum : Sets the **maximum packet delay** in milliseconds (ms).
* Packet Loss : Sets the **percentage of packet loss** (%). Accepts values between 0 and 100.
* Packet Jitter : Sets the **variation range** (in ms) added to the transmission delay. The actual delay will vary from Packet Lag Minimum to Packet Lag Minimum + Jitter.
* Packet Variance : Sets the **range of variable delay** (in ms) to be used instead of fixed value when Packet Lag (fixed delay) is enabled. (This is only applicable when the Packet Lag option is active.)

## Graphic Quality

Sets the graphic quality. (Provides the same settings options as mobile environment.)

<figure><img src="../../../.gitbook/assets/image (3).png" alt=""><figcaption></figcaption></figure>

<figure><img src="../../../.gitbook/assets/image (4).png" alt=""><figcaption></figcaption></figure>
