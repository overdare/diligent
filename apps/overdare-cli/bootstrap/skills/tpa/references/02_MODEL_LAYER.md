# Model Layer

Business logic and state. Models never touch Humanoid directly — View does that.

## CharacterModel — `ServerStorage/Module/Model/CharacterModel`

Per-player OOP instance. Owns FSM + ResourceModel + CombatModel via composition.

**Creation:** `CharacterModel.new(player, mergedConfig)` — registers FSM states, starts Heartbeat, stored in `_models[player]`.

**Config swap:** `SetCharacterConfig(config, skipHealthReset)` — resets combo, re-registers slots, reconfigures resource, updates Humanoid stats.

**Input handling:** `HandleInput(slotName)` — single entry point:
1. `SlotManager.Validate()` — checks cooldown + resource + SlotDef existence
2. `fsm:RequestChange(slotName)` — priority-based FSM transition
3. `resource:Spend(cost)` + `resource:StartCooldown()`
4. `fsm:FlushPending()` — commit FSM state transition before sequence playback
5. `humanoid:GetActionRunner():Play(sequencerId)` — play sequence via ActionRunner

**Hold release:** `HandleStop(slotName)` — on Hold skill button release:
1. FSM → Idle transition (`RequestChange` + `FlushPending`)
2. `ActionRunner:Stop(sequencerId)` — **sequence ID must be passed as argument** (Stop() without args is a no-op)

**Combat:** `OnHit(target, skillConfig)` — delegates to DefaultHit.ProcessHit → CombatModel.ApplyDamage

**Combo fields:** `_combo = {step, ready, buffered}`, `_comboSlot`, `_comboAdvancing`

**Lifecycle:** `OnSequenceEnd` (ignores if FSM current state ≠ slotName → combo advance or Idle), `OnDamaged` (Hit/Down/Stun routing), `OnSpawn`, `Destroy`

> **Stale callback guard:** When sequence A is replaced by sequence B, A's `TriggerEnded("Sequence")` fires and calls `OnSequenceEnd(slotA, ...)`. Since FSM is already in B's slot, `GetCurrentName() ≠ slotA` → ignored. Without this guard, B's `_activeHold` and other state would be corrupted.

## CombatModel — `ServerStorage/Module/Model/CombatModel`

Stateless damage pipeline with Before/After hooks.

`ApplyDamage(attackerChar, targetChar, params)` pipeline:
1. CreateIntent — builds intent table from params
2. OnBeforeDamage hooks — guard damage reduction
3. CombatView.ApplyDamage — HP subtraction
4. CombatView.ApplySelfDamage / ApplyHeal — optional self-cost / lifesteal
5. MovementView.Knockback — optional knockback impulse
6. StatusEffectModel.Apply — hit/self effects
7. OnDamageDealt hooks — energy gain
8. target CharacterModel:OnDamaged — FSM reaction

`AddHook("OnBeforeDamage" | "OnDamageDealt", fn)` — registered by ServerController.

**Intent fields:** damage, knockback, selfCost, lifesteal, hitEffects, selfEffects, down, stun.

## ResourceModel — `ServerStorage/Module/Model/ResourceModel`

Energy / Mana / Ammo per character. Configure(), Update(dt) for regen, OnHit() for gain, Spend/CanSpend, cooldown tracking via StartCooldown/IsOnCooldown.

## StatusEffectModel — `ServerStorage/Module/Model/StatusEffectModel`

Slow, SpeedBoost, DoT, HoT, Custom. Apply/Remove per character. Tick(dt) processes DoT/HoT. Name-based dedup (same effect name overwrites).

## FSM — `ServerStorage/Module/Model/StateMachine`

Priority-based state transitions. Same-name transition blocked. Idle always allowed.

| State | Priority | Type |
|---|---|---|
| Idle | 0 | Base |
| Attack | 10 | Action |
| Guard | 15 | Action |
| Skill | 20 | Action |
| Dash | 25 | Action |
| SpecialSkill | 30 | Action |
| Hit | 50 | Reaction |
| Stun | 55 | Reaction |
| Down | 60 | Reaction |
| Dead | 100 | Terminal |

Higher priority can interrupt lower. Lower cannot interrupt higher.

`FlushPending()` — public API. Immediately commits the pending state transition. Called in `HandleInput` before `ActionRunner:Play` to ensure FSM Enter completes before sequence playback begins.
