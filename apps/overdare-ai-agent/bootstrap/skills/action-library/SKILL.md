---
name: action-library
description: Build and extend action gameplay using ActionGameLibrary. Use when implementing melee or ranged combat, configuring weapons and skills, connecting Action Sequences to combat rules, or integrating player and NPC combat.
---

# ActionGameLibrary Guide

ActionGameLibrary connects action sequences and combat rules to a game. Use `ActionCore` for action execution alone, or `CombatLibrary` for health, damage, skills and combat rules. The game connects character selection, input, equipment, respawn and HUD to its own flow.

## Getting the library

Import `ovdrassetid://52222100` with `studiorpc_asset_drawer_import` (`assetType: "MODEL"`). It places every component listed under "Components and locations" at the paths shown there, including the presets and the runnable examples. Then require `ServerStorage/ActionGameLibrary/Combat/CombatLibrary` (or `ServerStorage/ActionGameLibrary/Core/ActionCore` for core-only actions) and follow "Connecting combat". If `ServerStorage/ActionGameLibrary` already exists, use it instead of importing again.

## Design principles

- **Separate action execution from combat rules.** ActionCore manages per-actor sequence start, interruption and completion, and forwards raw Collision/Trigger events. CombatLibrary maps profile slots to sequences and applies skills, damage, Guard, resources and teams. Combat uses the core; the core does not depend on health, SkillDB, teams, damage or client remotes.
- **The game owns actor lifecycle.** `CombatLibrary.Start()` prepares combat services. The game explicitly attaches Player/NPC models, equips weapons, requests actions and detaches actors. The current player/CPU duel is an example, not automatic library behavior.
- **Separate requests from authority.** Player clients request slot names; NPC AI uses server APIs. The server resolves targets, damage and team rules. Client scripts handle input and presentation.
- **Separate data from integration.** Profiles and SkillDB define slots and combat values; Action Sequence presets define animation and Collision timing; Tool presets define weapon visuals. Example scripts show one way to connect them.

## Components and locations

| Component | Studio path | Purpose |
| --- | --- | --- |
| Action core | `ServerStorage/ActionGameLibrary/Core/ActionCore` (`StateMachine`, `TimerQueue`) | Sequence lifetime, unique action tokens, timeouts and raw Hit/Trigger callbacks |
| Combat layer | `ServerStorage/ActionGameLibrary/Combat/{CombatLibrary,Systems}` | Profiles, slots, skills, health, damage, status, Dash, equipment and server input validation |
| Server integration guide | `ServerStorage/ActionGameLibrary/Examples/ServerBootstrapGuide` | Comments-only server integration example |

Require `ServerStorage/ActionGameLibrary/Core/ActionCore` or `ServerStorage/ActionGameLibrary/Combat/CombatLibrary` directly; no top-level forwarding modules are required. Combat extension points include `Systems/Controller/{CombatActionAdapter,SkillPolicy,ReactionPolicy,RuleManager,SequenceController,...}`, `Model`, `Rules`, `View`, `SlotDef`, `StateBehavior`, `States` and `SequenceHandler`.

Shared data/assets live at `ReplicatedStorage/ActionGameLibrary/Combat/{Data,Utilities,Network,Assets,VFXPool}`. Data contains SkillDB, CharDB, WeaponDB, Enums, SequenceHitEvents and SequenceLengths. `Network/Ability` contains RequestAbility, StopAbility and AbilityFeedback; `Network/Movement` contains CombatImpulse. `Assets/Weapons` holds Tool presets; `Assets/Effects` holds optional VFX templates. Sequence script templates are at `ReplicatedStorage/ActionGameLibrary/Core/Templates/ActionSequence`.

The 37 Action Sequence presets are at `ActionSequenceService/ActionGameLibrary/Combat/Presets`. ServerRuntime connects to ActionCore; ClientRuntime is a presentation extension point. The server combat layer applies damage.

The runnable examples `ServerScriptService/ActionGameLibrary/Examples/ExampleMinimalCombatServer` and `StarterPlayer/StarterPlayerScripts/ActionGameLibrary/Examples/ExampleMinimalCombatClient` are both **Enabled**. Play starts with Bow in practice mode: F/ATTACK attacks, Q/NEXT cycles Bow, Gun, TwoHandedSword, StoneSpear, Longsword and Fist, R/RESET recreates the target, and T/CPU toggles pursuit/attacks. `StarterGui/ExampleWeaponHUD` shows weapon, target HP and mode; its runtime visibility follows the example. The test remote is `ReplicatedStorage/ActionGameLibrary/Examples/WeaponTestControl`, outside library networking. Optional `CombatImpulseClient` and `CombatWeaponVisualClient` adapters are under the same StarterPlayerScripts root at `ActionGameLibrary/Combat`. Baseplate/SpawnLocation remain at `Workspace/ActionGameLibrary/Examples`; Camera and engine services stay at the Workspace root.

## Connecting combat

Start services, then attach a profile to a Player or NPC model. Slot names are game-facing requests; slot values are exact Action Sequence names.

```lua
local SS = game:GetService("ServerStorage")
local Combat = require(SS.ActionGameLibrary.Combat.CombatLibrary)
Combat.Start()

local actor, reason = Combat.AttachModel(character, {
	Attack = "Punch_Attack1",
	HitReaction = "Common_Hit_1",
})
if actor then
	Combat.RequestAction(character, "Attack")
end
-- When the game removes the actor: Combat.Detach(character)
```

`AttachModel` preserves existing Humanoid stats by default and equips no Tool. `Combat.Attach(player, charId, weaponId)` resolves catalog data and applies character stats. Equip a visible weapon separately with `Combat.EquipWeapon(owner, "Longsword")`. Players retain native Humanoid:EquipTool ownership. NPCs and explicit player visual overrides use the Tool's `CombatVisualBone` attribute or `{ BoneName = "LeftItem" }`; the client adapter renders bone-child visuals (Bow uses LeftItem). Detach cleans owned Tools/status effects and restores changed stats. The game owns respawn timing and reattachment.

Player input sends **only the slot name** through `ReplicatedStorage.ActionGameLibrary.Combat.Network.Ability.RequestAbility`. Only registered Player models are accepted; the server decides targets and damage. NPC AI calls `Combat.RequestAction(npc, slot)` on the server.

Register damage rules with `Combat.RegisterRule(name, rule)` and select them through `profile.Rules`, e.g. `{ "Guard", "ResourceOnHit" }`. CharDB CharA/CharB select these rules; direct AttachModel profiles do not inherit them.

### Weapon profiles and slots

`Combat.CreateWeaponProfile("StoneSpear")` returns an independent, ready-linked weapon profile without starting combat or equipping anything:

```lua
local profile = Combat.CreateWeaponProfile("StoneSpear")
local actor, reason, issues = Combat.AttachModel(character, profile)
if actor then Combat.EquipWeapon(character, profile.Tool) end
```

Built-in input slots are `Attack` (single/combo), `Skill`, `SpecialSkill`, `Guard` (hold) and `Dash` (dodge); `HitReaction` is not an input slot. A button labelled Evade still requests `Dash`. Numbered `Skill2` variants reuse Skill policy. New slot names require a module in `Systems/SlotDef` and the matching execution policy, not just a profile key.

`Combat.ValidateProfile(profile)` returns `ok, issues` before Start; each issue has Code/Slot/SequenceId/Message. Attach also diagnoses unknown slots and missing skill/sequence/length/Tool registrations before replacing an existing actor. Hit-event checks use registered metadata, not live authored track contents; keep Collision names and data aligned when editing assets.

### Skill overrides and replacements

`profile.Skills[id]` is a complete definition, not an implicit patch. Use explicit builders to show intent:

```lua
local profile = {
	Attack = "Punch_Skill1",
	Skills = {
		-- Change Damage only; retain Cooldown=5, WalkSpeed=0 and other fields.
		Punch_Skill1 = Combat.OverrideSkill("Punch_Skill1", { Damage = 45 }),
	},
}
-- Inherit nothing:
-- profile.Skills.Punch_Skill1 = Combat.ReplaceSkill({ Damage = 45 })
```

- `OverrideSkill(id, changes)` copies **SkillDB[id]** and replaces supplied top-level fields. It does not accumulate changes from an existing profile. Nested tables/arrays replace the entire field, not recursively merge.
- `ReplaceSkill(definition)` copies only the supplied definition. Custom IDs need no SkillDB entry, but their Action Sequence assets must exist.
- Both helpers deep-copy tables without modifying inputs or SkillDB, work before Start, and do not update profiles or attached actors. Put their results in the profile **before Attach**.
- Unknown OverrideSkill catalog IDs or invalid argument types raise errors. `false` and `0` are valid values. `nil` cannot be a patch entry; remove an inherited field from the returned copy or use ReplaceSkill.

Implementation: `ReplicatedStorage/ActionGameLibrary/Combat/Utilities/SkillConfig`; public API: `CombatLibrary.OverrideSkill/ReplaceSkill`. `require(SS.ActionGameLibrary.Examples.SkillConfigChecks).Run()` explicitly runs regression checks without automatically starting combat or attaching actors.

### Basic attacks and optional HP mechanics

Basic attacks have no self-cost or lifesteal. Bow provides `Bow_Shot` (20 damage, instant first-hit server ray up to 1200 cm, blocked by walls; no ballistic projectile). TwoHandedSword provides `TwoHandedSword_Attack1` (28 damage, forward melee Collision). Both include Dash. The CPU example lowers Sword damage only. `ServerStorage/ActionGameLibrary/Examples/AdvancedCombatProfiles` keeps `SelfCostSword()` and `LifestealSword()` separate: the second strike spends or heals a flat 30 HP per accepted hit. Neither is enabled by default.

### Ranged weapons: Bow and Gun

`CreateWeaponProfile("Bow")` and `CreateWeaponProfile("Gun")` are ready-linked Raycast profiles; Gun is a pistol with Attack, Skill and Dash. Attach and equip as above. To customize before Attach:

```lua
local profile = Combat.CreateWeaponProfile("Gun")
profile.Skills = {
	Gun_Attack1 = Combat.OverrideSkill("Gun_Attack1", { Damage = 10, Range = 1800 }),
}
```

- Per-skill `HitDetection`: `"Volume"` (default, authored Box/Sphere) or `"Raycast"` (first blocking server ray). Raycast uses collision key timing, not its volume, and follows the actor root's forward direction.
- `Range`: positive finite cm, default 1200. `RayOriginOffset`: root-local Vector3, default `(0, 20, 0)`. The first queryable wall or character blocks further hits; combat rules decide damage.
- OverrideSkill retains Raycast; ReplaceSkill must specify it explicitly. Camera aiming, ballistics, ammo/reload and auto-fire remain game-owned.

Optional `CombatWeaponPoseClient` uses a Tool's `CombatIdleAnimation` for grounded idle, yielding to movement/actions and cleaning up on unequip. Omit the attribute or disable the adapter when the game owns poses.

### NPC template

Use `ServerStorage/ActionGameLibrary/Examples/NPCTemplates/BasicRig`, preserving the Rig Builder server `Animate` Script, Humanoid/Animator and ActionRunner. A Player's Animate LocalScript is not an NPC driver. The example matches the player's WalkSpeed at target spawn and uses Humanoid:MoveTo when CPU mode is on; animation and AI remain in the game layer, not Combat.Start/Attach.

## Core-only actions

For sequences and raw Hit events without health or SkillDB, require `SS.ActionGameLibrary.Core.ActionCore` and call `ActionCore.AttachActor(model, callbacks)`. Request an action with `ActionCore.Request(model, "Gesture", { SequenceId = "Sword_Attack1", HitEvents = { "HitTrigger" }, Triggers = { "Sequence" } })`; use Stop and Detach as needed. `OnHit(actor, actionId, eventName, keyIndex, hitPart, token, spec)` reports Part observations; the game decides whether to apply damage. Action tokens are unique server-wide, including across reattachment.

## Presets and extensions

`Attack` is an input slot; `Punch_Attack1` is a sequence ID. Common catalog IDs are `Common_Block_1`, `Common_Tumbling_1`, `Common_Hit_1`, `Common_Hit2_1`. PunchVariant includes `PunchVariant_Attack1`, `PunchVariant_Attack2`, `PunchVariant_Skill1`, `PunchVariant_Skill_Ultimate`; TwoHandedSword also has the unmapped `TwoHandedSword_Skill1`. Preserve these and other reusable assets. Tool presets are Longsword, Bow, Gun, StoneSpear and TwoHandedSword; WeaponDB maps these plus Fist and None. StoneSpear provides `Spear_Thrust` (18 damage, forward box Collision) and Dash. Imported `Spear_Attack1` is a spin animation, not the starter thrust.

Collision key names must match combat `HitTriggers`/`SequenceHitEvents` (or core-only `HitEvents`); a single key normally uses `HitTrigger`. For independent multi-hits, give each key a unique name and list them in `Data.SequenceHitEvents[id]`. Update `Data.SequenceLengths` when changing duration. Collision keys at exactly 0 seconds do not execute. DefaultHit, SlotDef, StateBehavior and per-sequence scripts are extension points; check dependencies before changing them.

### Server hit path

Combat reads `GetAllTrackInfos()`, schedules keys from the owned runtime's start, rechecks ownership and calls `CharacterModel:OnHit`. Studio and deployment share this path; combat does not subscribe to native Hit. Core-only native callbacks are unchanged.

Volume supports root-attached, unrotated Box/Sphere at normal playback speed, without wall occlusion. `DefaultHit.Bind` is removed; direct `SequenceController.Bind(script)` cannot bind unowned runtimes. Extend `ProcessHit`/`Execute`, not native subscriptions. Missing track access reports `TRACK_INFO_UNAVAILABLE`; deployment still needs live verification. Opt-in test modules: `ServerHitChecks` and `RangedHitChecks` under `SS.ActionGameLibrary.Examples`; call `.Run()` explicitly.

Dash combines server Humanoid:MoveTo with sequence animation. Optional hit VFX require `HitVFXView.SetTemplatesFolder(ReplicatedStorage.ActionGameLibrary.Combat.Assets.Effects)`; VFXPool is used on playback.