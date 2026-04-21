# Extension Guide

Content extension (skill, character, weapon) = data edit OR plugin file add. Zero core code modification needed.
System extension (NPC AI, new game mechanisms, etc.) = structural code changes may be required; extend following existing architecture patterns.

## Quick Reference

| Goal | Edit | Layer |
|---|---|---|
| Change skill damage/cooldown | SkillDB | Data |
| Change character stats | CharDB | Data |
| Assign different skills to weapon | WeaponDB slots | Data |
| Add new skill | SkillDB + Action Sequence asset | Data |
| Add new character | CharDB + AssetDB | Data |
| Add new weapon | WeaponDB (+ Tool model) | Data |
| Add new slot (Skill2) | WeaponDB + SkillDB (SlotDef auto-derived) | Data |
| Add new button type (Ultimate) | SlotDef/Ultimate.lua | Plugin |
| Add new behavior (Charge) | StateBehavior/Charge.lua | Plugin |
| Add custom hit handler | SequenceHandler/Hit/XXX.lua | Plugin |
| Add custom action handler | SequenceHandler/Active/XXX.lua | Plugin |
| Add persistent effect (zone/projectile/trap) | SequenceHandler/Active + PersistentEffectManager.Register | Plugin+Controller |
| Custom weapon UI | UI/Weapon/{WeaponId}/ button prefabs | Editor |
| Smooth combo / recovery cancel | Add TriggerTrack "CancelWindow" in Action Sequencer Editor (also add KeyInput for combo) | Editor |
| Custom action timing | Add EventTrack "ActiveTrigger" in Action Sequencer Editor | Editor |

## Plugin Extension Principle

Existing plugins (DefaultHit, IceAoE, Combo, etc.) are reference implementations provided by the template.

- Plugin with **similar purpose AND not in use** → OK to modify.
- Plugin with **different purpose OR currently in use** → do NOT modify; create a new file in the same folder.

| Goal | Wrong (modify existing) | Right (new file) |
|---|---|---|
| Multi-explosion | Modify IceAoE.lua | Create Active/MultiExplosion.lua |
| Projectile hit | Modify DefaultHit.lua | Create Hit/ProjectileHit.lua |
| Charge attack | Modify Combo.lua | Create StateBehavior/Charge.lua |

## Add New Skill

1. Add entry to `SkillDB.lua` (use Enums for logic-branching fields like Movement, AoECenter):
```lua
FireBreath = { Damage = 15, Cooldown = 4, EnergyCost = 20,
               Movement = Enums.MovementType.Lock,
               AoERadius = 10, AoECenter = Enums.AoECenter.Forward },
```
2. Create Action Sequence asset named "FireBreath" in OVERDARE Studio
3. Add tracks: Animation, Sequence (TriggerTrack), HitTrigger (CollisionTrack)
4. Place ServerRuntime + ClientRuntime from templates
5. Assign in `WeaponDB.lua`:
```lua
Staff = { Skill = "FireBreath", ... },
```

## Add New Character

1. Add to `CharDB.lua`:
```lua
CharE = {
    Order = 5, DisplayName = "Assassin",
    MaxHp = 90, WalkSpeed = 700, RotationSpeed = 10,
    ResourceType = "Energy", ResourceMax = 80,
    ResourceRegen = 0, ResourceGainOnHit = 12,
    HitReaction = "Hit",
    DefaultWeapon = "Dagger",
},
```
2. Add weapon to `WeaponDB.lua`:
```lua
Dagger = {
    Tool = "Dagger",
    Attack = { "DaggerSlash1", "DaggerSlash2" },
    Skill = "ShadowStrike",
    Guard = "Parry",
    Dash = "Tumbling",
    SpecialSkill = "Assassination",
},
```
3. Add all skill entries to `SkillDB.lua`
4. Add portrait/select image to `AssetDB.lua` Characters section; add skill icons to Skills section
5. Create Action Sequence assets for each new skill

## Add New Weapon to Existing Character

1. Add weapon entry to `WeaponDB.lua` with skill slots
2. Add any new skills to `SkillDB.lua`
3. Create Action Sequence assets
4. Equip via: `ServerController.EquipWeapon(player, "NewWeapon")`

## Add Extra Slot (e.g. Skill2)

1. Add to weapon in `WeaponDB.lua`: `Skill2 = "IceBlast"`
2. Add skill to `SkillDB.lua`: `IceBlast = { ... }`
3. SlotDef auto-derives "Skill2" from "Skill" — no new SlotDef file needed
4. Button auto-maps if `Skill2Button` exists in Frame or weapon UI folder

## Custom Weapon UI (Button Override)

Place custom button prefabs in `ReplicatedStorage/UI/Weapon/{WeaponId}/`:
```
ReplicatedStorage/UI/Weapon/Gun/
  AttackButton
  SkillButton
  Skill2Button    -- custom size/position
  GuardButton
  DashButton
  SpecialSkillButton
```

- Folder name must match `WeaponDB` key (e.g. `Gun`, `Longsword`)
- Button names must follow `{SlotName}Button` convention
- When folder exists, ALL default Frame buttons are hidden and weapon folder buttons are cloned
- When folder does not exist, default Frame buttons are used (backward compatible)
- No code changes needed — just place the folder and buttons in OVERDARE Studio
