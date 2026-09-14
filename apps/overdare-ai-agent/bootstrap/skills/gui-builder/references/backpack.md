# Backpack and Native Inventory

Read this when a GUI task includes inventory, equipment selection, a hotbar, or hiding the default backpack. First inspect the game's actual item/controller model. A native Backpack stores player Tools, not a general-purpose inventory for currencies, arbitrary item records, or persistent ownership.

## What the default GUI already does

The official [Backpack reference](https://docs.overdare.com/development/api-reference/classes/backpack) documents that unequipped Tools in a player's Backpack appear automatically in the inventory UI at the bottom of the screen. Selecting a Tool equips it and moves it into the Character model. An equipped Tool is therefore no longer a Backpack child; a custom hotbar cannot discover all owned equipment by reading the Backpack alone.

The [Tool reference](https://docs.overdare.com/development/api-reference/classes/tool) places spawn/respawn equipment in `StarterPack`. Inspect both that template and the current player's Backpack/Character when checking what the player can select. Do not claim persistence across sessions from a StarterPack or Backpack alone. Creating new equipment or changing grants remains gameplay work outside a visual-only GUI edit.

For a simple Tool selector, retain the native backpack instead of creating duplicate slots and a second equip controller. Preserve its occupied space in the HUD guide. Default equipment selection does not prove that a weapon's firing, reload, or other gameplay actions are connected; inspect the owning controller separately.

Backpack can also contain Scripts and LocalScripts that execute there. Filter actual Tools when enumerating equipment; do not clone the whole container to populate a visual inventory.

## Native slot icons

[BackpackItem.TextureId](https://docs.overdare.com/development/api-reference/classes/backpackitem#textureid), inherited by Tool, specifies the inventory icon. If unset, the Tool's name is displayed instead. For an icon-only change, reuse or import the intended image, look up the accepted OVERDARE asset identifier for `TextureId`, and change the existing Tool rather than building an ImageButton hotbar. A local image path is not an imported asset identifier.

Keep the native widget when changing only equipment names, icons, or visibility. A full HUD design still follows [image-assets.md](image-assets.md) for newly authored artwork; retained default slots are layout context, not assets to regenerate.

## When custom inventory is needed

Use a custom screen for requested presentation or behavior that the existing native UI cannot supply: non-Tool items, quantities, categories, sorting, or a distinct equipment layout. Do not assume these features, drag/drop, slot counts, keyboard shortcuts, or mobile bounds are provided by the native Backpack.

For Tool-based equipment, keep the existing ownership/equip controller authoritative. Bind UI actions to its supported equip/unequip path; the official [Tool manual](https://docs.overdare.com/manual/studio-manual/object/tool) describes `Humanoid:EquipTool` and returning unequipped Tools to Backpack. Verify APIs with `overdaresearch` before wiring them. Do not clone, destroy, or grant Tools merely to update a slot highlight, or replace server validation with client UI state.

Only after the requested replacement is connected should its client controller hide the native UI:

```lua
local starterGui = game:GetService("StarterGui")
starterGui:SetCoreGuiEnabled(Enum.CoreGuiType.Backpack, false)
```

Read and retain the previous visibility setting before this override; restore it when the owning replacement is removed. Do not disable `All`, delete CoreGui descendants, or hide the joystick/jump controls to make room. See [core-gui.md](core-gui.md) for scope and visibility checks.

## Verify the actual inventory behavior

- Confirm icons/names and selection with representative Tools on the actual mobile viewport; check for duplicate native/custom selectors and touch overlap.
- Equip, switch, and unequip, then inspect actual Tool ownership and Backpack/Character placement rather than only a selected-slot color or click log. Ensure the game's tool-use behavior still works.
- Repeat after item changes and respawn. Re-resolve current character/container references and refresh the displayed equipped item without accumulating duplicate listeners; preserve the existing owner's lifecycle.
- Report untested cases. Empty inventory, a visibility setting, or a successful import alone does not establish a working inventory controller.
