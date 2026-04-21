---
name: actionsequence
description: "Handles Action Sequence asset creation/editing, track layout (Animation/Collision/Trigger/Event), combo setup, CancelWindow configuration, animation catalog lookup, ActionSequence JSON editing, and preset usage. Use this skill for any request involving action sequence assets or track timing. For code module work like SkillDB/CharDB/WeaponDB edits, server logic, or UI changes, use the tpa skill instead."
---

## 1. Overview

> **Naming rule**: Asset/system = **Action Sequence**, editor = **Action Sequencer** (editor only).

### Lifecycle

`ActionRunner:Play(sequencerId)` → asset is cloned under the character's Humanoid → ServerRuntime/ClientRuntime execute → clone is destroyed on sequence end (all child event connections auto-disconnect).

Objects cloned to external locations (ground zones, etc.) must be managed via `PersistentEffectManager`.

## 2. Track Types

**Clip-based (start~end range):** Animation, Sound, CameraShake, Trigger Track
**Key-based (single point):** Control, Collision, Event, Camera FOV, Camera Zoom

CollisionTrack detects hit targets via area overlap; callbacks fire individually per target (not as an array).
TriggerTrack operates as "apply → restore" pairs. On sequence replacement, the previous sequence's End fires before the new sequence's Start.

See `references/guide.md` for API usage and code examples.

## 3. Track Naming Convention

Names auto-recognized by `SequencerController.Bind(script)`. Present = bound, absent = skipped.

### TriggerTrack
| Name | Role | Required |
|---|---|---|
| `Sequence` | Sequence lifetime. Start=movement lock, End=unlock+FSM Idle | Required |
| `KeyInput` | Combo input accept window. Start=ready, End=clear | Combo only |
| `CancelWindow` | Combo instant transition + general cancel. Place at sequence tail | Optional |

### CollisionTrack
| Name Pattern | Role |
|---|---|
| `HitTrigger` / `HitTrigger{N}` | Area detection hit (customizable via SkillDB `HitTriggers` field) |

### EventTrack (Markers)
| Name | Role |
|---|---|
| `ActiveTrigger` / `ActiveTrigger{1~10}` | Custom action callback (SkillDB `ActiveHandler` or `options.OnActiveTrigger`) |

## 4. CancelWindow

Placed at the tail of a sequence to handle **combo instant transition + general cancel** with a single track.

```
Animation: [████████████████████████████████████████]
Sequence:  [████████████████████████████████████████]
CancelW:                                    [██████]
```

- Same-slot combo buffer exists → immediately advance to next combo step
- Not a combo → cancelable ON → other slot input can cancel current sequence
- Range ends → cancelable OFF

To enable combo, also add a `KeyInput` TriggerTrack.

## 5. Combo System

**Mode A — Wait for sequence end (default):** `Sequence` End → if buffered, next combo step.
**Mode B — CancelWindow instant transition:** `CancelWindow` Started → if buffered, replace sequence immediately.

Combos apply to ANY slot defined as a **table** in WeaponDB (not just Attack).

## 6. ServerRuntime / ClientRuntime

**Standard:** `SequencerController.Bind(script)` / `ClientBridge.Bind(script)` (1 line). Auto-resolves sequence name → WeaponDB/SkillDB and binds Movement, Hit, Combo, CancelWindow, Hold, SequenceEnd, ActiveTrigger, etc.

**Freeform:** Write code directly without Bind. Callback `self` = executing character.

## 7. Sequence Naming Rules

- **No duplicates** within the project
- Multiple characters can share the same sequence
- Sequence name = SkillDB key = WeaponDB slot value

## 8. Asset Authoring Quick Reference

| Goal | Required Tracks | Notes |
|---|---|---|
| Basic attack | Sequence + Animation + HitTrigger | CollisionTrack for hit detection |
| Combo attack | Above + KeyInput | Defined as table in WeaponDB |
| Smooth combo | Above + CancelWindow | Place at tail |
| Hold skill (guard) | Sequence + Animation | SkillDB InputType=Hold |
| Dash | Sequence + Animation | SkillDB ClientDash config |
| Multi-hit | Sequence + Animation + HitTrigger1~N | Multiple CollisionTracks |
| Custom action | Above + ActiveTrigger EventTrack | SkillDB ActiveHandler or callback |
| Recovery cancel | Add CancelWindow TriggerTrack | Via editor |

## 9. Reference Resources (`references/`)

### Asset Authoring Guide — `references/guide.md`

Read this first when authoring assets. Contains production workflow, layout/direction rules, camera/control track rules, keyframe properties, and API reference.

### Animation Catalog — `references/animations/`

Category-based list of Overdare animation assets. Read `references/animations/00_INDEX.md` first, then only the category files relevant to your task. Do not read all at once.

### JSON Reference — `references/json/`

JSON data of existing Action Sequence assets. When authoring new assets, reference similar existing assets for track composition, timing, and settings to maintain consistency.
