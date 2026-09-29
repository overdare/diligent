---
name: actionsequence
description: "Handles Action Sequence asset creation/editing, track layout (Animation/Sound/Collision/Trigger/Event), animation catalog lookup, ActionSequence JSON editing and apply_json diagnostics, and preset usage. Use this skill for any request involving action sequence assets or track timing."
---

## 1. Overview

> **Naming rule**: Asset/system = **Action Sequence**, editor = **Action Sequencer** (editor only).

### Lifecycle

`ActionRunner:Play(sequencerId)` → asset is cloned under the character's Humanoid → ServerRuntime/ClientRuntime execute → clone is destroyed on sequence end (all child event connections auto-disconnect). ServerRuntime/ClientRuntime callbacks receive the executing character as `self`.

## 2. Track Types

**Clip-based (start~end range):** Animation, Sound, CameraShake, Trigger Track
**Key-based (single point):** Control, Collision, Event, Camera FOV, Camera Zoom

CollisionTrack detects hit targets via area overlap; callbacks fire individually per target (not as an array).
TriggerTrack operates as "apply → restore" pairs. On sequence replacement, the previous sequence's End fires before the new sequence's Start.

See `references/guide.md` for API usage and code examples.

## 3. Sequence Naming Rules

- **No duplicates** within the project
- Multiple characters can share the same sequence

## 4. Reference Resources (`references/`)

### Asset Authoring Guide — `references/guide.md`

Read this first when authoring assets. Contains production workflow, layout/direction rules, camera/control track rules, keyframe properties, and API reference.

### Animation Catalog — `references/animations/`

Category-based list of Overdare animation assets. Read `references/animations/00_INDEX.md` first, then only the category files relevant to your task. Do not read all at once.

### JSON Reference — `references/json/`

Current-format JSON templates (Header.version 2). When authoring new assets, reference similar existing assets for track composition, timing, and settings to maintain consistency.

Before generating or applying JSON, read [references/json-format.md](references/json-format.md) for the current Studio property requirements, a SoundTrack example, persistence checks, and `apply_json` failure diagnostics. Studio rejects missing properties even when it logs them only as optional-property warnings.
