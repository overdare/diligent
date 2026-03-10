# Material Manager

## Overview <a href="#overview" id="overview"></a>

Using the Material Manager, you can manage various materials and apply them to objects to enhance visual quality.



## Displaying the Material Manager Panel <a href="#displaying-the-material-manager-panel" id="displaying-the-material-manager-panel"></a>

The Material Manager panel can be displayed by clicking the **Material Manager button** in the **Model tab**, which appears in the top tab area of OVERDARE Studio.

<figure><img src="../../../.gitbook/assets/material-manager-1.png" alt=""><figcaption></figcaption></figure>



## How to Use <a href="#how-to-use" id="how-to-use"></a>

### Adding a MaterialVariant <a href="#adding-a-materialvariant" id="adding-a-materialvariant"></a>

You can create a MaterialVariant by clicking the **+ Variant button** in the top-right corner of the Material Manager panel.

<figure><img src="../../../.gitbook/assets/MaterialManager-1.png" alt=""><figcaption></figcaption></figure>



Alternatively, you can **click on a Material** to open the Material Panel, then click the **+ Variant button** to create a MaterialVariant.

<div align="left"><figure><img src="../../../.gitbook/assets/image (59).png" alt=""><figcaption></figcaption></figure></div>



### Editing a MaterialVariant <a href="#editing-a-materialvariant" id="editing-a-materialvariant"></a>

Click on a created MaterialVariant to display its panel, where you can modify its properties or delete the variant.

<figure><img src="../../../.gitbook/assets/image (60).png" alt=""><figcaption></figcaption></figure>



### Material Variant Properties <a href="#material-variant-properties" id="material-variant-properties"></a>

| Category      | Description                                                                                                                                     |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Name          | Allows you to rename the MaterialVariant.                                                                                                       |
| Base Material | <p>Specifies the Base Material that the MaterialVariant references.</p><p>You can choose from Basic, Plastic, Brick, Rock, Metal, or Unlit.</p> |



#### **Texture Maps**

<table><thead><tr><th>Category</th><th width="254">Description</th><th>Notes</th></tr></thead><tbody><tr><td>Color</td><td>Changes the material's color.</td><td>-</td></tr><tr><td>Metalness</td><td>Defines the metallic appearance of the model's surface.</td><td>You can import a file or adjust the value.<br>*Value range: 0.0 ~ 1.0</td></tr><tr><td>Normal</td><td>Provides surface height details to create a more complex texture.</td><td>You can import a file or adjust the value.<br>*Value range: 0.0 ~ 1.0</td></tr><tr><td>Roughness</td><td>Defines the roughness of the model's surface.</td><td>You can import a file or adjust the value.<br>*Value range: 0.0 ~ 1.0</td></tr></tbody></table>



#### **Tiling**

<table><thead><tr><th>Category</th><th width="254">Description</th><th>Default</th></tr></thead><tbody><tr><td>Unit Per Tile</td><td>Defines how many Studs the material's tile texture repeats over.</td><td>Default is 1.</td></tr></tbody></table>



#### **Physics**

<table><thead><tr><th>Category</th><th width="254">Description</th><th>Value Range</th></tr></thead><tbody><tr><td>Density</td><td>Adjusts the density of the MaterialVariant.</td><td>0.01~100</td></tr><tr><td>Friction</td><td>Adjusts the friction of the MaterialVariant.</td><td>0~2.0</td></tr><tr><td>Elasticity</td><td>Adjusts the elasticity of the MaterialVariant.</td><td>0~1.0</td></tr></tbody></table>



### Applying a Material to a Part <a href="#applying-a-material-to-a-part" id="applying-a-material-to-a-part"></a>

To apply a Material or MaterialVariant to a Part, select the Part, hover over the Material or MaterialVariant, and click the **button** shown in the image below.

<figure><img src="../../../.gitbook/assets/image (61).png" alt=""><figcaption></figcaption></figure>



Alternatively, select the Part you want to apply the Material or MaterialVariant to, click the Material or MaterialVariant, and then click the **Apply button** in the displayed panel.

<figure><img src="../../../.gitbook/assets/image (62).png" alt=""><figcaption></figcaption></figure>



You can also apply a MaterialVariant by directly entering its name in the properties window.

<figure><img src="../../../.gitbook/assets/material-manager-2.png" alt=""><figcaption></figcaption></figure>
