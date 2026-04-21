# Melee Animation Catalog

Asset Package: BasicMeleeAnimations
Purpose: TPA melee combat basic movement motions (generic melee weapon equipped state)
Default Stance: Holding a melee weapon (axe/hammer, etc.) in right hand.

---

## BasicMeleeIdleAnimation

- Asset ID: ovdrassetid://18449100
- Category: Idle
- Duration: 1.60s
- Motion: Combat idle stance holding melee weapon in right hand with slightly lowered center of gravity
- Attack Direction: None

---

## BasicMeleeWalkAnimation

- Asset ID: ovdrassetid://18453100
- Category: Movement
- Duration: 0.93s
- Motion: Melee combat walk moving naturally with weapon held in right hand
- Attack Direction: None

---

## BasicMeleeRunAnimation

- Asset ID: ovdrassetid://18447400
- Category: Movement
- Duration: 0.66s
- Motion: Melee combat run moving forward with weapon held in right hand
- Attack Direction: None

---

## BasicMeleeJumpAnimation

- Asset ID: ovdrassetid://18447200
- Category: Movement
- Duration: 0.33s
- Motion: Melee combat jump start leaping upward while holding weapon
- Attack Direction: None
- Notes: Connects to MeleeJumpLoop → MeleeLanding.

---

## BasicMeleeJumpLoopAnimation

- Asset ID: ovdrassetid://18449300
- Category: Movement
- Duration: 0.73s
- Motion: Melee combat jump loop hovering in the air while holding weapon
- Attack Direction: None

---

## BasicMeleeLandingAnimation

- Asset ID: ovdrassetid://18449200
- Category: Movement
- Duration: 0.73s
- Motion: Melee combat landing absorbing impact with knees while holding weapon
- Phases:
  - Landing: 0.00~0.30s — Feet touch ground, knees bend
  - Recovery: 0.30~0.73s — Returns to combat idle stance
- Attack Direction: None

---

## BasicMeleeAttackAnimation

- Asset ID: ovdrassetid://18447100
- Category: Attack
- Duration: 0.56s
- Motion: Melee weapon attack pulling weapon back then swinging forward to strike
- Phases:
  - Anticipation: 0.00~0.14s — Pulls right arm with weapon back
  - Impact: 0.14~0.28s — Swings weapon forward in a downward strike
  - Recovery: 0.28~0.56s — Pulls weapon back and returns to combat stance
- Attack Direction: Forward (Weapon swing)
