# State Animation Catalog

Asset Package: BasicStateAnimations
Purpose: Character state reaction motions (hit reaction, defense, stun, death, climbing, etc.)

---

## BasicHitAnimation

- Asset ID: ovdrassetid://18414100
- Category: Hit Reaction
- Duration: 0.40s
- Motion: Hit reaction flinching from a frontal hit, body recoils then recovers
- Phases:
  - Hit reaction: 0.00~0.15s — Impact causes upper body to flinch forward
  - Peak flinch: ~0.15s — Maximum flinch pose
  - Recovery: 0.15~0.40s — Returns to combat stance
- Attack Direction: None
- Notes: Most versatile hit reaction.

---

## BasicDefenceAnimation

- Asset ID: ovdrassetid://18417100
- Category: Defense
- Duration: 0.36s
- Motion: Reflexive defense reaction briefly raising both arms to block
- Phases:
  - Guard: 0.00~0.18s — Quickly raises both arms to cover body
  - Recovery: 0.18~0.36s — Lowers arms and returns to basic stance
- Attack Direction: None
- Notes: Shorter reflexive guard (0.36s) compared to Basic package defense (1.06s).

---

## BasicStunAnimation

- Asset ID: ovdrassetid://18423100
- Category: State
- Duration: 2.50s
- Motion: Stunned state standing with head drooped, arms hanging limp, staggering
- Phases:
  - Stun enter: 0.00~0.40s — Head wobbles, body staggers
  - Stun hold: 0.40~2.00s — Head drooped, arms hanging, swaying
  - Stun release: 2.00~2.50s — Regains consciousness and recovers
- Attack Direction: None
- Notes: Stun duration controlled separately by game logic.

---

## BasicDeathAnimation

- Asset ID: ovdrassetid://25702100
- Category: State
- Duration: 1.46s
- Motion: Backward death motion falling back and lying on the ground face up
- Phases:
  - Fall: 0.00~0.60s — Knees buckle, body falls backward
  - Landing: 0.60~1.00s — Back hits the ground, body extends
  - Still: 1.00~1.46s — Lies motionless
- Attack Direction: None

---

## BasicDeath_FrontAnimation

- Asset ID: ovdrassetid://18419100
- Category: State
- Duration: 1.40s
- Motion: Forward death motion kneeling then collapsing face down
- Phases:
  - Fall: 0.00~0.50s — Drops to knees and tilts forward
  - Landing: 0.50~0.90s — Falls face down onto the ground
  - Still: 0.90~1.40s — Lies prone motionless
- Attack Direction: None
- Notes: For hit from behind or forward collapse scenes.

---

## BasicClimbAnimation

- Asset ID: ovdrassetid://18932100
- Category: Movement
- Duration: 0.93s
- Motion: Climbing motion moving hands and feet alternately to climb walls or ladders
- Attack Direction: None

---

## BasicFallDieAnimation

- Asset ID: ovdrassetid://18421100
- Category: State
- Duration: 0.86s
- Motion: Fall death motion hitting the ground after falling from a height
- Phases:
  - Falling: 0.00~0.30s — Limbs spread while falling
  - Impact+Collapse: 0.30~0.86s — Hits the ground, body crumples
- Attack Direction: None
- Notes: Longer version (0.86s) compared to Basic package version (0.43s).
