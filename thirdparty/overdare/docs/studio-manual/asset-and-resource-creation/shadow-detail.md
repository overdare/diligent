# Setting Shadow Detail

## Overview

The **Shadow Detail Level** is an optimization technique that adjusts the complexity of shadow calculations. For more distant objects, a simplified mesh (Low-Detail Mesh) is used to calculate shadows, thus reducing rendering load and improving overall game performance.



## How to Use

### Setting Global Shadow

To enable shadows, first select the Lighting service. Then, in the Property panel, enable either Sun Cast Shadows or Moon Cast Shadows, depending on the time of day used in your game.

<figure><img src="../../../.gitbook/assets/image.png" alt=""><figcaption></figcaption></figure>



### Individual Shadow Settings

After selecting a mesh, enabling **Enable Mesh Shadow Details** in the Properties panel allows you to specify the **Mesh Shadow Detail Level** for each mesh. In this case, the mesh’s settings take precedence over the global settings of the Lighting service.

(If a mesh’s shadow is not visible, check if **Cast Shadow** is enabled in the mesh’s Properties panel.)

<figure><img src="../../../.gitbook/assets/Shadow-Detail2.png" alt=""><figcaption></figcaption></figure>



### Shadow Representation Based on Shadow Detail Level

Setting the Shadow Detail Level to Original results in detailed shadows based on the original mesh shape, while Medium or Low settings produce simpler shadow forms.

<figure><img src="../../../.gitbook/assets/Shadow-Lod-3.png" alt=""><figcaption><p>From left to right: Original, Medium, Low</p></figcaption></figure>



## Note

To display shadows, go to the Settings menu on your mobile device that runs the OVERDARE app, and set the Graphics option to **Prioritize Quality**.

<figure><img src="../../../.gitbook/assets/image (143).png" alt=""><figcaption></figcaption></figure>



## Usage Example

Since shadow complexity significantly impacts game performance, it's recommended to set global shadow complexity as low as possible and apply highly complex shadows only to specific meshes of high importance.
