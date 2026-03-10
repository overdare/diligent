# Collision Groups

## Overview <a href="#overview" id="overview"></a>

Collision Groups allow you to finely manage collisions between objects. You can set specific groups of objects to collide with each other or prevent collisions between different groups, enabling you to create various game scenarios.



## Displaying the Collision Groups Panel <a href="#displaying-the-collision-groups-panel" id="displaying-the-collision-groups-panel"></a>

The Collision Groups panel can be displayed by clicking the **Collision Groups button** in the **Model tab**, which appears in the top tab area of OVERDARE Studio.

<figure><img src="../../../.gitbook/assets/collision-group-1.png" alt=""><figcaption></figcaption></figure>



## How to Use <a href="#how-to-use" id="how-to-use"></a>

### Adding a Collision Group <a href="#adding-a-collision-group" id="adding-a-collision-group"></a>

Click the **+ New Group button** in the top-right corner of the Collision Groups window to create a new group. New groups are initially named **New Group**, and you can rename them to manage up to 17 groups.

{% hint style="info" %}
The Default Group, which is created by default, cannot be renamed or deleted.

Group names can be up to 50 characters long.
{% endhint %}

<figure><img src="../../../.gitbook/assets/image (54).png" alt=""><figcaption></figcaption></figure>



All Parts are included in the **Default Group** until their collision group is manually modified.



### Managing Collision Groups <a href="#managing-collision-groups" id="managing-collision-groups"></a>

Right-click on a group name to rename it using **Rename** or delete it using **Delete**.

{% hint style="info" %}
You cannot rename a group to an already existing group name.
{% endhint %}

<figure><img src="../../../.gitbook/assets/image (55).png" alt=""><figcaption></figcaption></figure>



### Setting Collisions Between Groups <a href="#setting-collisions-between-groups" id="setting-collisions-between-groups"></a>

You can configure whether collisions occur between registered collision groups.

For example, selecting the Sphere Team group in the Collision Groups window and enabling Default in the collision settings on the right allows Parts in the Sphere Team group to collide with Parts in the Default group.\
(Conversely, disabling a group prevents collisions with that group.)

<figure><img src="../../../.gitbook/assets/image (56).png" alt=""><figcaption></figcaption></figure>



### Setting Collision Groups for Parts <a href="#setting-collision-groups-for-parts" id="setting-collision-groups-for-parts"></a>

Select the Part you want to assign to a collision group, then in the properties window, enter the name of the Collision Group to assign it.

Each Part can belong to **only one** Collision Group.

<figure><img src="../../../.gitbook/assets/image (57).png" alt=""><figcaption></figcaption></figure>



## Script Feature

{% content-ref url="../../../development/api-reference/classes/physicsservice.md" %}
[physicsservice.md](../../../development/api-reference/classes/physicsservice.md)
{% endcontent-ref %}
