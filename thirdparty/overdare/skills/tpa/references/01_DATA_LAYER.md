# Data Layer

All game balance in 4 data files + 1 Enum file. These are the primary editing targets.

## Enums.lua — `ReplicatedStorage/Data/Enums`

Constants used in if/elseif branches. **Only logic-branching values** are managed as Enums. Naming-only values (ResourceType) use free strings.

```lua
return {
    InputType    = { Press = "Press", Hold = "Hold", Charge = "Charge" },
    MovementType = { Lock = "Lock", Slow = "Slow", None = "None" },
    StatusType   = { Slow = "Slow", SpeedBoost = "SpeedBoost", DoT = "DoT",
                     HoT = "HoT", Custom = "Custom" },
    AoECenter    = { Self = "Self", Forward = "Forward" },
}
```

| Category | Enum? | Reason |
|---|---|---|
| InputType | Yes | `"Hold"` / `"Press"` comparison for button binding / hold logic |
| MovementType | Yes | `"Lock"` / `"Slow"` comparison for movement lock / slowdown |
| StatusType | Yes | 6 types each with entirely different status effect logic |
| AoECenter | Yes | `"Forward"` / `"Self"` comparison for AoE center calculation |
| ResourceType | No | UI label / naming only. No logic branching. Free string |

## SkillDB.lua — `ReplicatedStorage/Data/SkillDB`

Single file defining ALL skills. Key name = Action Sequence asset name. Logic-branching fields reference `Enums`.

```lua
local Enums = require(script.Parent:WaitForChild("Enums"))

return {
    Punch1     = { Damage = 10, Movement = Enums.MovementType.Lock },
    Punch2     = { Damage = 15, Movement = Enums.MovementType.Lock, Knockback = 30 },
    GroundSlam = { Damage = 30, Cooldown = 5, EnergyCost = 20,
                   Movement = Enums.MovementType.Lock, Knockback = 50 },
    Guard      = { InputType = Enums.InputType.Hold,
                   DamageReduction = 0.5,
                   Movement = { Type = Enums.MovementType.Slow, Speed = 5 } },
    Tumbling   = { Cooldown = 2, Movement = Enums.MovementType.Lock,
                   ClientDash = { Speed = 1000 } },
    Hit        = {},  -- hit reaction (no damage)
}
```

**Fields:** Damage, Cooldown, EnergyCost, Movement (Enums.MovementType.Lock or {Type=Enums.MovementType.Slow, Speed=N}), InputType (Enums.InputType.Hold), Knockback, SelfCost, Lifesteal, HitEffects, SelfEffects, ActiveHandler, ClientDash, ClientTeleport.

## CharDB.lua — `ReplicatedStorage/Data/CharDB`

Character **stats only**. Skills live in WeaponDB.

```lua
return {
    CharA = {
        Order = 1, DisplayName = "Fighter",
        MaxHp = 100, WalkSpeed = 600, RotationSpeed = 8,
        ResourceType = "Energy", ResourceMax = 100,
        ResourceRegen = 0, ResourceGainOnHit = 10,
        HitReaction = "Hit",
        DefaultWeapon = "Fist",
    },
}
```

**Meta fields** (not skill slots): Order, DisplayName, MaxHp, WalkSpeed, RotationSpeed, ResourceType, ResourceMax, ResourceRegen, ResourceGainOnHit, HitReaction, DefaultWeapon.

## WeaponDB.lua — `ReplicatedStorage/Data/WeaponDB`

Skill slot mappings per weapon. Table value = combo, string = single skill.

```lua
return {
    None = {},
    Fist = {
        Attack       = { "Punch1", "Punch2" },
        Skill        = "GroundSlam",
        Guard        = "Guard",
        Dash         = "Tumbling",
        SpecialSkill = "PowerKick",
    },
    Longsword = {
        Tool         = "Longsword",
        Attack       = { "SwordAttack1", "SwordAttack2" },
        Skill        = "SwordWhirlwind",
        Guard        = "SwordGuard",
        Dash         = "Tumbling",
        SpecialSkill = "PowerKick",
    },
}
```

## Config Merge

`ConfigUtil.ResolveConfig(charId, weaponId)` merges CharDB stats + WeaponDB skills into one config. CharacterModel receives this merged table.

## AssetDB.lua — `ReplicatedStorage/Data/AssetDB`

Visual assets in sections: Characters (portraits, select images), Skills (shared skill icons), Defaults (fallback), UI (common), Resource (preload animation OvdrAssetId array). Slot icon chain: Skills[skillName] → Defaults → nil. Portrait/select image chain: Characters[charId] → Defaults → nil.

Resource table contains `ovdrassetid://` strings extracted from `ActionSequencerAnimationTrack` entries in ActionSequenceJSON files. Organized by weapon/common category. LoadingScreen batch-preloads these via `AssetLoaderUtil.PreloadAnimations` at game start.
