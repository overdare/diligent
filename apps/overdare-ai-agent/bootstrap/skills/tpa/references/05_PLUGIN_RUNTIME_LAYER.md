# Plugin + Runtime Layer

## SlotDef — `ServerStorage/Module/SlotDef/`

Each file defines one input slot (button). SlotManager scans folder on Init().

```lua
local Enums = require(game:GetService("ReplicatedStorage"):WaitForChild("Data"):WaitForChild("Enums"))

return {
    Name = "Skill",
    DisplayName = "Skill",
    Priority = 20,
    UI = { ButtonName = "SkillBtn",
           Position = UDim2.new(0.75, 0, 0.55, 0),
           Size = UDim2.new(0, 70, 0, 70),
           ShowCooldown = true, ShowResource = true },
    Input = { Type = Enums.InputType.Press },
    Transitions = { AllowFrom = {"Idle"},
                    BlockFrom = {"Down","Stun","Dead","Skill"},
                    CancelOnDamage = true },
    Validate = { RequireCooldown = true, MinResource = true },
    Behavior = { StateType = "Action",
                 OnEnter = "Attack", OnExit = "Idle" },
}
```

**Built-in SlotDefs:**

| Name | Priority | Behavior | Input |
|---|---|---|---|
| Attack | 10 | Combo | Press |
| Guard | 15 | Hold | Hold |
| Skill | 20 | Action | Press |
| Dash | 25 | Action | Press |
| SpecialSkill | 30 | Action | Press |

**Auto-derivation:** If "Skill2" has no SlotDef file, it is auto-derived from "Skill" with adjusted name and priority. This allows WeaponDB to define extra slots without creating new SlotDef files.

## SequenceHandler — `ServerStorage/Module/SequenceHandler/`

Handler plugins connected to Action Sequence signals. Organized into Hit/Active subfolders by signal source.

### Hit — `SequenceHandler/Hit/`

Handlers connected to CollisionTrack `:Hit()` signals. Regardless of Collider Type (Box, Sphere, Capsule, Cone, Ray Cast) set in the editor, these handlers receive targets detected by the engine.

| Handler | Use |
|---|---|
| DefaultHit | Default hit processing — applies CombatModel.ApplyDamage to detected targets |

Must implement `handler.Bind(actionSequencer, character, charModel, config)`.
Hit events → `charModel:OnHit(target, skillConfig)` → `handler.ProcessHit` → `CombatModel.ApplyDamage`.

Skills without CollisionTrack (Guard, etc.) never fire `:Hit()` signals, so no special handling is needed.

### Active — `SequenceHandler/Active/`

Custom logic triggered at EventTrack "ActiveTrigger" timing in the sequence.

**Method A — Plugin (reusable, 1-line ServerRuntime):**
SkillDB: `{ ActiveHandler = "IceAoE" }`. Handler must implement `Execute(seq, char, player, config, triggerName)`.

**Method B — Direct callback (special cases):**
```lua
SequencerController.Bind(script, {
    OnActiveTrigger = function(seq, char, player, config, triggerName)
        -- spawn zone, apply buff, etc.
    end,
})
```

EventTrack names: "ActiveTrigger", "ActiveTrigger1" through "ActiveTrigger10".

**Sequence lifetime warning:** ActiveHandler.Execute runs in the sequence's ServerRuntime context. Effects that must outlive the sequence (AoE zones, projectiles, etc.) MUST use `PersistentEffectManager.Register()` to delegate to a permanent context. Direct Heartbeat connections will be disconnected when the sequence clone is destroyed.

## StateBehavior — `ServerStorage/Module/StateBehavior/`

FSM behavior delegates: **Action** (press→execute→end), **Hold** (hold→release), **Combo** (chain attacks). GenericActionState picks behavior from SlotDef.Behavior.StateType.

## Runtime Templates — `ReplicatedStorage/Template/ActionSequence/`

- **ServerRuntime:** `SequencerController.Bind(script)` (1 line)
- **ClientRuntime:** `ClientBridge.Bind(script)` (1 line)

Each Action Sequence asset gets copies of these. All logic handled by Bind — no manual wiring.
