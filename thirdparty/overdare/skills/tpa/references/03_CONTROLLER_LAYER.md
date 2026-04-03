# Controller Layer

Routes input to Model, delivers results to View. Never owns game state.

## ServerController — `ServerStorage/Module/Controller/ServerController`

Main server entry point. `Init()` sets up everything on game start.

**RemoteEvent handlers:**
- `RequestAbility → model:HandleInput(slotName)` — one call handles all logic
- `StopAbility → model:HandleStop(slotName)` — hold skill release → FSM Idle transition + `ActionRunner:Stop(seqId)`
- `SelectCharacter → OnSelectCharacter(player, charId)`

**OnSelectCharacter flow:**
1. Validate CharDB[charId]
2. `ConfigUtil.ResolveConfig(charId, defaultWeapon)` — merge config
3. `model:SetCharacterConfig(mergedConfig)` — swap config
4. `_swapTool()` — equip Tool model
5. Update StringValues: SelectedCharacter, EquippedWeapon

**EquipWeapon(player, weaponId, skipToolSwap):**
- Weapon change without character change
- HP preserved via skipHealthReset=true
- Auto-adds to backpack

**Backpack API:** AddToBackpack, RemoveFromBackpack, GetBackpack — weapon inventory management.

**CombatModel hooks registered in Init():**
- OnBeforeDamage: guard damage reduction (checks FSM state == "Guard")
- OnDamageDealt: energy gain via ResourceModel:OnHit()

**Heartbeat:** StatusEffectModel.Tick(dt) + resource value sync to Player NumberValue.

**CharacterAdded:** Creates CharacterModel, sets up StringValues (SelectedCharacter, EquippedWeapon, Energy), equips default Tool, monitors Tool pickup via ChildAdded.

## SequencerController — `ServerStorage/Module/Controller/SequencerController`

Every ServerRuntime calls `SequencerController.Bind(script, options?)`.

**What Bind does:**
1. `_findCharacter()` helper walks ancestor chain to find character Model (depth-independent)
2. Reverse-lookup via SlotUtil: sequence name → slotName + SkillDB config (with `_N` suffix fallback)
3. Auto-binds based on SkillDB config:
   - **Movement:** Sequence TriggerTrack → MovementView.Lock / Unlock / SetSpeed (branches on Enums.MovementType)
   - **Hit:** DefaultHit.Bind (SequenceHandler/Hit/DefaultHit — CollisionTrack :Hit() binding)
   - **Combo:** KeyInput TriggerTrack → SetComboReady / ClearComboReady
   - **CancelWindow:** TriggerTrack "CancelWindow" → combo: AdvanceComboImmediate if buffered, otherwise: cancelable flag ON (general cancel)
   - **Hold:** marks activeHold on model (InputType == Enums.InputType.Hold)
   - **SequenceEnd:** TriggerEnded("Sequence") → OnSequenceEnd
   - **ActiveTrigger:** options.OnActiveTrigger callback OR SkillDB ActiveHandler plugin

**ActiveTrigger priority:** options callback > SkillDB.ActiveHandler > skip.

## SlotManager — `ServerStorage/Module/Controller/SlotManager`

Plugin scanner. Init() auto-loads all folders: SlotDef, SequenceHandler/Hit, SequenceHandler/Active, StateBehavior.

- `GetSlot(name)` — returns SlotDef. Auto-derives numbered variants ("Skill2" from "Skill")
- `Validate(player, slot, config, resource)` — cooldown + resource check
- `RegisterStates(fsm, config)` — registers GenericActionState for each known + dynamic slot
- `GetHitHandler(type)` / `GetActiveHandler(name)` / `GetBehavior(type)`

## PersistentEffectManager — `ServerStorage/Module/Controller/PersistentEffectManager`

General-purpose module that manages persistent effects in a permanent Heartbeat context, surviving beyond sequence lifetime.

**Background:** When a sequence clone is destroyed, all Heartbeat connections made by its child scripts are automatically disconnected. External objects placed in workspace (AoE zones, projectiles) remain but lose their management loop — no damage ticks, no movement, no cleanup. PersistentEffectManager solves this by connecting its Heartbeat from the ServerController.Init() context (ServerMain lifetime).

**Initialization:** `PersistentEffectManager.Init()` called in `ServerController.Init()` (before SlotManager.Init).

**API:**
- `Register({ duration, onTick, onDestroy, isDone, data })` — register effect with injected callbacks
- `Remove(id)` — early removal (e.g. projectile hit)

**Callbacks:**
- `onTick(effect, dt)` — called every Heartbeat. Access free data via effect.data
- `onDestroy(effect)` — called once on expiry or isDone==true
- `isDone(effect)` — optional. Return true to trigger immediate cleanup

**Used by:** SequenceHandler/Active (IceAoE etc.), future traps/heal zones.
