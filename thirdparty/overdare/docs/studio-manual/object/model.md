# Model

## Overview <a href="#overview" id="overview"></a>

A Model is an object that groups multiple objects together so they can be **affected by physics collectively** and controlled as a single unit. This allows individual objects to be treated as one entity or for specific actions to be applied simultaneously.



## Properties <a href="#properties" id="properties"></a>

### Primary Part <a href="#primary-part" id="primary-part"></a>

This property sets the Part that will act as the center of the Model. For Character Models, the PrimaryPart is the HumanoidRootPart.



### Transform <a href="#transform" id="transform"></a>

* Origin
  * Position: Defines the world coordinates of the Model.
  * Orientation: Sets the rotation direction of the Model.



When the PrimaryPart is not set, the Origin is arbitrary. When the PrimaryPart is set, the Origin is based on the PrimaryPart.



## Grouping Objects into a Model <a href="#grouping-objects-into-a-model" id="grouping-objects-into-a-model"></a>

To group objects, select the objects you want to group, right-click, and click **Group As a Model** (or press Ctrl + G).

![Group As a Model.png](../../../.gitbook/assets/StudioManual-model-Group_As_a_Model.png)



When objects are grouped into a Model, clicking on a **Part within the Model** in the Viewport will select the entire Model instead of the individual Part. To select only the Part, **hold the Alt key** while clicking. To select multiple Parts within the Model, hold **Alt + Ctrl** while clicking.
