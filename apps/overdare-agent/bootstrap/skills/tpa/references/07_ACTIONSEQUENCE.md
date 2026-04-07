# Action Sequence

> **Naming rule**: Asset/system = **Action Sequence**, editor = **Action Sequencer** (editor only).

## Lifecycle and Auto-Cleanup

When an Action Sequence is played via `ActionRunner:Play(sequencerId)`:
1. The entire sequence asset (Tracks, child scripts, objects) is **Cloned under the character's Humanoid**
2. ServerRuntime/ClientRuntime scripts inside the clone execute
3. On sequence end (normal end or replaced by another sequence), the **clone instance is Destroyed**

When the clone is destroyed, all child event connections are automatically disconnected. No manual cleanup needed.
Objects cloned to external locations (e.g. ground zones) exist outside the sequence and require `PersistentEffectManager` for lifecycle management.

## Track Types

**Clip-based (start~end range):** Animation, Sound, CameraShake, Trigger Track
**Key-based (single point):** Control, Collision, Event, Camera FOV, Camera Zoom

### CollisionTrack

Performs area detection (Overlap) at specified timing to detect hit targets.

```lua
actionSequencer:Hit("HitTrigger"):Connect(function(self, hitTarget)
    -- self = executing character, hitTarget = single target
end)
```

If 4 targets are detected, the callback fires 4 times individually (not as an array).

### TriggerTrack Start/End Pattern

TriggerTrack operates as **"apply → restore"** pairs. When sequence B starts during sequence A, A's `TriggerEnded` fires automatically → B's `TriggerStarted` fires. Safe to modify state in Start and restore in End.

> **Note:** The `Sequence` TriggerEnded callback (`OnSequenceEnd`) **only processes when the FSM current state matches the slot name**. End callbacks from a replaced sequence are ignored because the FSM has already transitioned to the new slot.

## Track Naming Convention

Names auto-recognized by `SequencerController.Bind(script)`. Present = bound, absent = skipped.

### TriggerTrack
| Name | Role | Required |
|---|---|---|
| `Sequence` | Sequence lifetime. Start=movement lock, End=unlock+FSM Idle | Required |
| `KeyInput` | Combo input accept window. Start=ready, End=clear | Combo only |

### CollisionTrack
| Name Pattern | Role |
|---|---|
| `HitTrigger` / `HitTrigger{N}` | Area detection hit (customizable via SkillDB `HitTriggers` field) |

### EventTrack (Markers)
| Name | Role |
|---|---|
| `ActiveTrigger` / `ActiveTrigger{1~10}` | Custom action callback (SkillDB `ActiveHandler` or `options.OnActiveTrigger`) |

## CancelWindow (Unified Cancel Region)

`CancelWindow` is a TriggerTrack (range-based), placed at the tail end of a sequence to handle **combo instant transition + general cancel** with a single track.

```
Animation: [████████████████████████████████████████]
Sequence:  [████████████████████████████████████████]
CancelW:                                    [██████]
```

**Behavior:**
- If same-slot combo buffer exists → immediately advance to next combo step (replaces old CancelPoint)
- If not a combo → sets cancelable flag ON → any other slot input cancels current sequence
- When range ends → cancelable OFF (sequence ends normally if no input)

When authoring assets, place `CancelWindow` at the tail. Combo vs general cancel is determined by WeaponDB/SkillDB config.
To enable combo, also add a `KeyInput` TriggerTrack.

## Combo System

Input buffering is **FSM state-based**. Same-slot re-input rejected by FSM → immediately `buffered = true`. Independent of `KeyInput` window.

**Mode A — Wait for sequence end (default):** `Sequence` End triggers `AdvanceCombo()` → if buffered, next combo step.
**Mode B — CancelWindow immediate transition:** On `CancelWindow` Started, if buffered, replace sequence while keeping FSM state. `_comboAdvancing` flag prevents previous sequence's `OnSequenceEnd` from transitioning to Idle.

Combos apply to ANY slot defined as a **table** in WeaponDB, not just Attack.

## ServerRuntime / ClientRuntime

**Standard:** 1-line wrapper. `SequencerController.Bind(script)` / `ClientBridge.Bind(script)`. Bind auto-resolves sequence name → WeaponDB/SkillDB and binds Movement, Hit, Combo, CancelWindow, Hold, SequenceEnd, ActiveTrigger, ClientDash, ClientTeleport.

**Freeform:** Write code directly without Bind. Callback `self` parameter = executing character.

## Sequence Naming Rules

- **No duplicates** within project
- Multiple characters can share the same sequence
- Sequence name = SkillDB key = WeaponDB slot value

## Presets (Planned)

| Preset | Included Tracks | Purpose |
|---|---|---|
| BasicAttack | Sequence + Animation + HitTrigger | Single attack |
| ComboAttack | BasicAttack + KeyInput | Combo-chainable attack |
| SmoothCombo | BasicAttack + KeyInput + CancelWindow | Smooth combo |
| HoldSkill | Sequence + Animation | Hold type (guard etc.) |
| DashAction | Sequence + Animation | Dash/movement skill |
| MultiHit | BasicAttack + HitTrigger1~N | Multi-hit |
