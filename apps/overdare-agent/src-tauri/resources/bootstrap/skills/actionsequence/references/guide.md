# Action Sequencer Production Guide

## Production Workflow

### 1) Analyze Request

- Identify attack/skill type, hit count, target/area, VFX/SFX, and direction intent
- Define per-hit animation, timing (frames/seconds), keyframe events, and section ranges
- Select animation: punch request → Punch types, sword request → Sword types

### 2) Add Control Objects

- Add objects to be controlled in the sequence (`Part`, `VFXPreset`, etc.) via MCPTool
- Organize with unique identifiers referenceable in JSON

### 3) Create Action Sequence Instance

- Create a new Action Sequence instance via MCPTool
- Configure timeline basics (FPS/seconds), prepare root track and sub-tracks

### 4) Generate JSON

- Format reference: Use JSON files under `references/json/` as templates
- Composition principles:
  - Reflect anticipation → impact → recovery flow
  - Specify animation clip length, blending, root motion presence, event trigger timing
  - Multi-hit example: Hit1 → transition → Hit2 → transition → Hit3 (finisher), escalating intensity

### 5) Inject and Verify JSON

- Inject JSON into the Action Sequence instance via MCPTool
- Verify hit detection ↔ VFX/SFX sync, section transitions, total play duration, loop/end behavior

## Layout and Direction Rules

- Design around animation timing and impact points, not just listing keyframes/sections
- Align camera, VFX, sound, and hit detection triggers with impact frames
- Escalate intensity, speed, and VFX progressively for multi-hit sequences

## Camera FOV/Zoom Rules

- FOV and Zoom cannot be used simultaneously — use one or the other
- Defaults: FOV = 90, Zoom = 400
- Camera track values reset after the last keyframe (not maintained)
- Runtime camera effects apply only to the Player executing the action sequence

## Control Track Rules

- Add control tracks only when referencing objects
- Referenced object names must be globally unique (maintain unique identifiers)
- Reference the top-level parent object when possible
- Placing a `VFXPreset` as a child of a `Part` and referencing the parent `Part` via control track also controls the child

### Cautions

- Only include objects that are actually controlled under the action sequence, and always reference them in control tracks
- Deactivate or remove collision settings from unused objects
- Disable `CanCollide` for collision objects like `Part`
- Avoid duplicate object names (name-based referencing causes malfunction with duplicates)

### Keyframe Properties (by Instance Type)

| Type | Properties |
|---|---|
| Model | OriginPosition, OriginRotation |
| Part | Shape, Transparency, CanCollide, CanTouch, Size, OriginPosition, OriginRotation |
| MeshPart | Transparency, CanCollide, CanTouch, Size, OriginPosition, OriginRotation |
| ParticleEmitter | Enabled, Rate, Emit |
| VFXPreset | Enable |

## Track-Script Event Principle

When creating Trigger/Control/Collision tracks, always connect corresponding script events.

## API Reference

### Play

```lua
local ActionRunner = Humanoid:GetActionRunner()
ActionRunner:Play("ActionSequenceKey")
```

### Transition Play

```lua
ActionRunner:Play("AttackAction", 0.5) -- TransitionTime > 0 triggers transition playback
```

### Get Playing Sequences

```lua
local Actions = ActionRunner:GetActionSequences()
-- During transition, two or more may exist simultaneously, sorted by play order
```

### Stop

```lua
ActionRunner:Stop("SomeActionName")
ActionRunner:StopAll()
```

### ActionRunner Events

```lua
ActionRunner.Ended:Connect(function(self, key) end)   -- self = character model, key = sequence name
ActionRunner.Stopped:Connect(function(self, key) end)
```

### Collision Track Binding

```lua
local ActionSequence = script.Parent
ActionSequence:Hit("CollisionEventName"):Connect(function(self, other)
    -- self = executing character, other = detected target
end)
```

### Event Track Binding

```lua
ActionSequence:GetMarkerReachedSignal("EventName"):Connect(function(self) end)
```

### Trigger Track Binding

```lua
ActionSequence:TriggerStarted("TriggerName"):Connect(function(self) end)
ActionSequence:TriggerEnded("TriggerName"):Connect(function(self) end)
```

### Script Placement Rules

- Event connection scripts must be placed as children of the Action Sequence instance
- Server-side `Script` should be placed directly under the Action Sequence
- When connecting from `LocalScript`, callbacks fire on all clients — filter by executing character (`self`)
