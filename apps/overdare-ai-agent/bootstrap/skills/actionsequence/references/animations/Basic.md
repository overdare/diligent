# Basic Animation Catalog

Asset Package: BasicAnimations
Purpose: Default movement/action motions when no weapon is equipped

---

## BasicIdleAnimation

- Asset ID: ovdrassetid://18162100
- Category: Idle
- Duration: 2.13s
- Motion: Basic idle stance standing with arms naturally at sides, gently breathing
- Attack Direction: None
- Notes: Default Idle when no weapon is equipped.

---

## BasicWalkAnimation

- Asset ID: ovdrassetid://18162300
- Category: Movement
- Duration: 1.03s
- Motion: Basic walk moving forward with natural arm swing
- Attack Direction: None

---

## BasicRunAnimation

- Asset ID: ovdrassetid://18163100
- Category: Movement
- Duration: 0.60s
- Motion: Basic run moving forward with wide arm swing
- Attack Direction: None

---

## BasicJumpAnimation

- Asset ID: ovdrassetid://18392100
- Category: Movement
- Duration: 0.33s
- Motion: Jump start motion bending knees then leaping upward
- Attack Direction: None
- Notes: Jump start. Connects to JumpLoop → Landing in sequence.

---

## BasicJumpLoopAnimation

- Asset ID: ovdrassetid://18394100
- Category: Movement
- Duration: 0.73s
- Motion: Jump loop hovering in the air with limbs slightly spread
- Attack Direction: None

---

## BasicLandingAnimation

- Asset ID: ovdrassetid://18394200
- Category: Movement
- Duration: 0.73s
- Motion: Landing motion absorbing impact by bending knees upon touching ground
- Phases:
  - Landing: 0.00~0.30s — Feet touch ground, knees bend
  - Recovery: 0.30~0.73s — Extends knees and returns to standing stance
- Attack Direction: None

---

## BasicAttackAnimation

- Asset ID: ovdrassetid://18396100
- Category: Attack
- Duration: 0.60s
- Motion: Left-right consecutive punches — extends right fist forward and retracts, then extends left fist
- Phases:
  - Right punch: 0.00~0.20s — Extends right fist forward and retracts
  - Left punch: 0.20~0.40s — Extends left fist forward
  - Recovery: 0.40~0.60s — Retracts left fist and returns to basic stance
- Attack Direction: Forward horizontal (Left-right consecutive punches)
- Notes: Right→Left 2-hit punch combo.

---

## BasicKickAnimation

- Asset ID: ovdrassetid://18398100
- Category: Attack
- Duration: 0.40s
- Motion: Basic front kick lifting right knee then quickly extending forward
- Phases:
  - Anticipation: 0.00~0.10s — Lifts right knee
  - Impact: 0.10~0.22s — Right foot extends forward
  - Recovery: 0.22~0.40s — Retracts foot and returns to stance
- Attack Direction: Forward horizontal (Front kick)

---

## BasicDashAnimation

- Asset ID: ovdrassetid://18935100
- Category: Movement
- Duration: 0.47s
- Motion: Short dash crouching low and charging forward quickly
- Phases:
  - Dash: 0.00~0.30s — Lowers body forward and advances rapidly
  - Recovery: 0.30~0.47s — Decelerates and returns to basic stance
- Attack Direction: None

---

## BasicDefenceAnimation

- Asset ID: ovdrassetid://23654100
- Category: Defense
- Duration: 1.06s
- Motion: Basic defense stance with both arms raised and crossed in front of face
- Phases:
  - Guard enter: 0.00~0.20s — Crosses both arms and raises them in front of face
  - Guard hold: 0.20~0.80s — Maintains crossed guard stance
  - Guard release: 0.80~1.06s — Lowers arms and returns to basic stance
- Attack Direction: None

---

## BasicFallDieAnimation

- Asset ID: ovdrassetid://23656100
- Category: State
- Duration: 0.43s
- Motion: Fall death motion tumbling backward and collapsing
- Phases:
  - Tumble: 0.00~0.25s — Body curls and tumbles backward
  - Collapse: 0.25~0.43s — Lies on ground
- Attack Direction: None
