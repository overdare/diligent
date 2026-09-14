# Built-in GUI

Before adding a gameplay HUD, inventory, or replacement control, identify what the engine already provides. An empty `StarterGui` does not mean there is no runtime UI. `CoreGui` contains system-owned UI; author custom screens in `StarterGui` and bind their runtime `PlayerGui` copies rather than adding or deleting CoreGui descendants.

## Documented support

The official [CoreGuiType reference](https://docs.overdare.com/development/api-reference/enums/coreguitype) currently lists:

| CoreGuiType | Documented behavior | GUI Builder use |
|---|---|---|
| `Backpack` | Displays the player's backpack. | Check the native Tool inventory before building a custom hotbar; read [backpack.md](backpack.md). |
| `Joystick` | Virtual movement joystick. | Retain movement and its full touch/drag space. |
| `JumpButton` | Avatar jump button. | Retain it or connect a replacement using [custom-jump.md](custom-jump.md). |
| `All` | Controls all CoreGui elements together. | Do not use it to hide one control. |

`PlayerList`, `Health`, `Chat`, `EmotesMenu`, and `SelfView` are marked **currently not supported**. Their enum names are not evidence that working default widgets exist. The StarterGui page's generic Chat example does not override that support table. Check current OVERDARE documentation and the installed runtime with `overdaresearch` before depending on a feature; do not substitute Roblox APIs or support claims.

## Inspect before replacing

Use a client `LocalScript` to inspect the relevant visibility setting through [StarterGui](https://docs.overdare.com/development/api-reference/classes/startergui):

```lua
local starterGui = game:GetService("StarterGui")
local backpackEnabled = starterGui:GetCoreGuiEnabled(Enum.CoreGuiType.Backpack)
print("Backpack enabled:", backpackEnabled)
```

Read existing GUI/input scripts for visibility overrides and inspect the play-test screen with representative content. An enabled setting is not a measurement of bounds or proof that inventory content exists. A screenshot without native UI is not proof that it is disabled. The bundled mobile controls image shows movement/jump context; it is not a complete inventory layout reference.

Keep active native controls and system navigation accessible. For Tool-based games, inspect the bottom inventory strip as well as joystick/jump regions before placing ammo panels or combat buttons. Use the actual viewport and interactions, including selecting equipment while moving; do not invent fixed backpack pixel bounds.

Change only the requested control with `SetCoreGuiEnabled`. Record its previous setting and restore it when removing an override owned by this controller. A replacement must work before hiding the native control. Visibility changes do not replace movement, jumping, item ownership, or equip behavior.

Sources: [CoreGui](https://docs.overdare.com/development/api-reference/classes/coregui), [CoreGuiType](https://docs.overdare.com/development/api-reference/enums/coreguitype), [StarterGui](https://docs.overdare.com/development/api-reference/classes/startergui).
