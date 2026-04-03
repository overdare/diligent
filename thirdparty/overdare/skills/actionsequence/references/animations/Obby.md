# Obby Animation Catalog

Asset Package: OBBYAnimations
Purpose: Obstacle course / special movement motions

---

## BalanceIdleAnimation

- Asset ID: ovdrassetid://22029100
- Category: Idle
- Duration: 1.40s
- Motion: Balance idle standing on a narrow platform with arms spread to maintain balance
- Attack Direction: None

---

## BalanceWalkAnimation

- Asset ID: ovdrassetid://22030200
- Category: Movement
- Duration: 1.40s
- Motion: Balance walk carefully stepping along a narrow platform with arms spread
- Attack Direction: None

---

## RopeClimbIdleAnimation

- Asset ID: ovdrassetid://22032100
- Category: Idle
- Duration: 1.60s
- Motion: Rope idle hanging with both hands gripping a rope
- Attack Direction: None

---

## RopeClimbUpAnimation

- Asset ID: ovdrassetid://22034100
- Category: Movement
- Duration: 1.06s
- Motion: Climbing motion ascending a rope by alternating hands upward
- Attack Direction: None

---

## RopeClimbDownAnimation

- Asset ID: ovdrassetid://22035100
- Category: Movement
- Duration: 1.60s
- Motion: Descending motion going down a rope by alternating hands downward
- Attack Direction: None

---

## BasicRollingAnimation

- Asset ID: ovdrassetid://18839100
- Category: Movement
- Duration: 0.66s
- Motion: Forward roll curling body and tumbling forward once
- Phases:
  - Roll: 0.00~0.45s — Curls forward and rolls once
  - Recovery: 0.45~0.66s — Stands up and returns to stance
- Attack Direction: None

---

## CrashFallingAnimation

- Asset ID: ovdrassetid://22037100
- Category: State
- Duration: 1.50s
- Motion: Stumble fall motion losing footing and tumbling downward
- Phases:
  - Stumble: 0.00~0.40s — Loses footing and balance
  - Fall: 0.40~1.50s — Flails limbs while falling
- Attack Direction: None

---

## FlounderEdgeStopAnimation

- Asset ID: ovdrassetid://22039100
- Category: State
- Duration: 1.00s
- Motion: Precarious stop barely halting at a cliff edge while flailing arms
- Phases:
  - Stagger: 0.00~0.60s — Flails arms to regain balance
  - Stabilize: 0.60~1.00s — Barely steps back to safety
- Attack Direction: None

---

## EdgeSlipAnimation

- Asset ID: ovdrassetid://22040100
- Category: State
- Duration: 1.10s
- Motion: Slip motion where feet slide off a cliff edge and fall
- Phases:
  - Slip: 0.00~0.50s — Feet slip and lose grip on the edge
  - Fall start: 0.50~1.10s — Begins falling downward
- Attack Direction: None
- Notes: Can connect to CrashFalling.

---

## FlounderFallingAnimation

- Asset ID: ovdrassetid://22041100
- Category: State
- Duration: 1.33s
- Motion: Panicked fall motion flailing limbs frantically while falling (loopable)
- Attack Direction: None

---

## HardLandingAnimation

- Asset ID: ovdrassetid://22043100
- Category: State
- Duration: 2.16s
- Motion: Hard landing from a great height, hitting the ground with knees and both hands
- Phases:
  - Impact: 0.00~0.60s — Lands on knees and hands
  - Recovery: 0.60~2.16s — Slowly gets up and returns to stance
- Attack Direction: None

---

## SlopeSlidingAnimation

- Asset ID: ovdrassetid://22044100
- Category: Movement
- Duration: 0.53s
- Motion: Sliding motion sitting down and sliding down a slope
- Attack Direction: None

---

## HangIdleAnimation

- Asset ID: ovdrassetid://18889100
- Category: Idle
- Duration: 0.80s
- Motion: Hanging idle dangling from both hands like a chin-up position
- Attack Direction: None

---

## HangMoveAnimation

- Asset ID: ovdrassetid://23672100
- Category: Movement
- Duration: 1.00s
- Motion: Hanging traverse moving sideways by alternating hands while hanging
- Attack Direction: None
- Notes: Legacy asset ovdrassetid://18889200 also exists with same motion.

---

## JumpSecondaryAnimation

- Asset ID: ovdrassetid://20487100
- Category: Movement
- Duration: 0.56s
- Motion: Double jump motion performing an additional leap while airborne
- Attack Direction: None

---

## SquatIdleAnimation

- Asset ID: ovdrassetid://18891100
- Category: Idle
- Duration: 0.80s
- Motion: Crouch idle squatting low with bent knees
- Attack Direction: None

---

## SquatMoveAnimation

- Asset ID: ovdrassetid://18891300
- Category: Movement
- Duration: 0.80s
- Motion: Crouch move carefully advancing in a low crouched position
- Attack Direction: None

---

## CrawlIdleAnimation

- Asset ID: ovdrassetid://18893100
- Category: Idle
- Duration: Unknown
- Motion: Prone idle lying face down with elbows and knees on the ground
- Attack Direction: None

---

## CrawlMoveAnimation

- Asset ID: ovdrassetid://18894200
- Category: Movement
- Duration: Unknown
- Motion: Prone crawl moving forward by alternating arms and legs while lying face down
- Attack Direction: None

---

## ShovingAnimation

- Asset ID: ovdrassetid://22847100
- Category: Attack
- Duration: 0.56s
- Motion: Shoving attack pushing a target forward with both hands
- Phases:
  - Anticipation: 0.00~0.15s — Pulls both arms back
  - Shove: 0.15~0.30s — Pushes forward forcefully with both hands
  - Recovery: 0.30~0.56s — Returns to stance
- Attack Direction: Forward (Shove)

---

## ShoveReactionAnimation

- Asset ID: ovdrassetid://22848200
- Category: Hit Reaction
- Duration: 0.63s
- Motion: Shove hit reaction staggering backward after being pushed
- Phases:
  - Pushed back: 0.00~0.30s — Impact pushes body backward
  - Recovery: 0.30~0.63s — Regains balance
- Attack Direction: None

---

## DodgingBackAnimation

- Asset ID: ovdrassetid://22848400
- Category: Movement
- Duration: 1.00s
- Motion: Backstep motion quickly stepping backward to evade
- Phases:
  - Evade: 0.00~0.50s — Steps backward quickly
  - Recovery: 0.50~1.00s — Stabilizes stance
- Attack Direction: None

---

## HitOnTheBackAnimation

- Asset ID: ovdrassetid://22847200
- Category: Hit Reaction
- Duration: 1.16s
- Motion: Rear hit reaction staggering forward after being struck from behind
- Phases:
  - Hit: 0.00~0.40s — Impact on back pushes body forward
  - Recovery: 0.40~1.16s — Staggers and turns to recover stance
- Attack Direction: None
