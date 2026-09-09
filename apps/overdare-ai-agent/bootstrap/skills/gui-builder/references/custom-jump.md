# Custom Jump Button

Use this when connecting a custom jump control or replacing default jump, either explicitly requested or chosen during a new/full HUD design using [studio-ui.md](studio-ui.md). Hide the default only as part of that working replacement. Preserve it when the user requires default controls or the task is an unrelated small edit. Reuse existing button artwork when suitable.

## Runtime connection

Read the existing GUI and movement controller first. Reuse the project's jump action if it already owns input gates or character state. Otherwise, the basic runtime path is the custom button's `Activated` event setting the current local character's `Humanoid.Jump` to `true`.

Create the button statically in Studio and add or edit its runtime `LocalScript` through the script tools. The following fragment assumes the owning `ScreenGui` contains a verified `ImageButton` named `Jump`; adjust the hierarchy to the project. It runs in the player's copied GUI, not the Editor VM.

```lua
local starterGui = game:GetService("StarterGui")
local player = game:GetService("Players").LocalPlayer
local button = script.Parent:WaitForChild("Jump") :: ImageButton

button.Activated:Connect(function()
	local character = player.Character
	if not character then return end
	local humanoid = character:FindFirstChild("Humanoid") :: Humanoid
	if not humanoid or humanoid.Health <= 0 then return end
	humanoid.Jump = true
end)
```

For the chosen replacement, connect the new button first, then hide the default:

```lua
starterGui:SetCoreGuiEnabled(Enum.CoreGuiType.JumpButton, false)
```

Connect the replacement before hiding the default. Use `StarterGui:GetCoreGuiEnabled(Enum.CoreGuiType.JumpButton)` to read its visibility state. Do not delete CoreGui descendants or disable `Enum.CoreGuiType.All`; the joystick and unrelated system UI should keep working.

Hiding the button changes its visibility, not the character's jump mechanics. Preserve `JumpHeight`, `JumpPower`, `UseJumpPower`, jump counts, and existing movement restrictions. Do not zero those values or disable the Jumping state to hide the default button.

## Lifecycle and verification

- Resolve the current character on activation rather than keeping a Humanoid from before respawn. Follow the existing GUI owner's lifecycle: rebind a recreated button and reapply the intended visibility without accumulating duplicate listeners. If removing the replacement, restore the previously recorded default-button state when this controller owns that override.
- Validate the changed script, start play, and confirm `GetCoreGuiEnabled(JumpButton)` is false for replacement mode. Inspect the actual screen for one working jump control and an unaffected joystick.
- Activate the custom button while grounded and verify character movement or jump state, not just a click log or color change. Repeat after landing and after respawn. Temporary position measurements can provide evidence; do not bake the session's measured jump height into gameplay or a universal test threshold.
- Report only the lifecycle cases actually exercised. Button visibility and successful input delivery alone do not prove a jump occurred.

API references: [StarterGui](https://docs.overdare.com/development/api-reference/classes/startergui), [Humanoid.Jump](https://docs.overdare.com/development/api-reference/classes/humanoid#jump).
