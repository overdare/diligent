# Punch Animation Catalog

Asset Package: PunchAnimations
Weapon Type: Unarmed (Fists/Feet)
Purpose: TPA Fist Combat System

---

## PunchIdleAnimation

- Asset ID: ovdrassetid://18168100
- Category: Idle
- Duration: 1.00s
- Motion: Boxing fighting stance with both fists raised to face height, gently swaying side to side
- Attack Direction: None

---

## PunchAttackAnimation01

- Asset ID: ovdrassetid://18169100
- Category: Attack
- Duration: 0.43s
- Motion: Left jab — quick jab extending left fist forward from guard stance
- Phases:
  - Anticipation: 0.00~0.10s — Slightly pulls left shoulder back
  - Impact: 0.10~0.22s — Left fist extends straight forward
  - Recovery: 0.22~0.43s — Retracts fist and returns to guard
- Attack Direction: Forward horizontal (Jab)
- Notes: Combo hit 1. Fastest basic attack.

---

## PunchAttackAnimation02

- Asset ID: ovdrassetid://18171100
- Category: Attack
- Duration: 0.53s
- Motion: Right straight — driving right fist forward forcefully with hip rotation
- Phases:
  - Anticipation: 0.00~0.12s — Twists right shoulder and waist back
  - Impact: 0.12~0.28s — Right fist extends straight forward
  - Recovery: 0.28~0.53s — Retracts fist and returns to guard
- Attack Direction: Forward horizontal (Straight)
- Notes: Combo hit 2. Slower but more powerful than jab.

---

## PunchAttackAnimation03

- Asset ID: ovdrassetid://18170300
- Category: Attack
- Duration: 0.70s
- Motion: Left hook — twists body left then swings left fist inward from the side
- Phases:
  - Anticipation: 0.00~0.18s — Twists upper body left, pulls left arm back
  - Impact: 0.18~0.35s — Left fist sweeps in a left-to-right arc
  - Recovery: 0.35~0.70s — Returns to guard stance
- Attack Direction: Left-to-right horizontal (Hook)
- Notes: Combo hit 3. Can bypass guard.

---

## PunchAttackAnimation04

- Asset ID: ovdrassetid://18173100
- Category: Attack
- Duration: 0.76s
- Motion: Right uppercut — bends knees then drives right fist upward from below
- Phases:
  - Anticipation: 0.00~0.20s — Bends knees and pulls right arm downward
  - Impact: 0.20~0.40s — Extends legs while right fist rises from below
  - Recovery: 0.40~0.76s — Returns to guard stance
- Attack Direction: Bottom-to-top (Uppercut)
- Notes: Combo hit 4. Suitable for launch judgment.

---

## PunchAttackAnimation05

- Asset ID: ovdrassetid://18173200
- Category: Attack
- Duration: 0.73s
- Motion: Left body hook — lowers upper body and swings left fist at torso height from the side
- Phases:
  - Anticipation: 0.00~0.18s — Leans upper body right, pulls left arm back
  - Impact: 0.18~0.38s — Hip rotation drives left fist inward at torso height
  - Recovery: 0.38~0.73s — Returns to guard
- Attack Direction: Left-to-right horizontal (Body hook)
- Notes: Combo hit 5. Low-trajectory hook for mid-level attack.

---

## PunchAttackAnimation06

- Asset ID: ovdrassetid://18173300
- Category: Attack
- Duration: 1.26s
- Motion: Jump spinning kick — jumps forward and spins in the air to deliver a kick
- Phases:
  - Anticipation: 0.00~0.30s — Bends knees to prepare for jump
  - Leap+Impact: 0.30~0.70s — Leaps into the air, spins body and kicks
  - Landing+Recovery: 0.70~1.26s — Lands and returns to guard
- Attack Direction: Forward rotation (Aerial kick)
- Notes: Combo finisher hit 6. Longest motion, high stagger and power.

---

## PunchDefenceAnimation

- Asset ID: ovdrassetid://18444100
- Category: Defense
- Duration: 1.06s
- Motion: High guard defense with both arms crossed and raised in front of head
- Phases:
  - Guard enter: 0.00~0.20s — Quickly raises both arms in front of face
  - Guard hold: 0.20~0.80s — Maintains crossed-arm defense
  - Guard release: 0.80~1.06s — Lowers arms and returns to fighting stance
- Attack Direction: None

---

## PunchDogdeAnimation

- Asset ID: ovdrassetid://23660100
- Category: Movement
- Duration: 0.80s
- Motion: Backstep evasion leaning upper body back and stepping backward
- Phases:
  - Evade: 0.00~0.40s — Leans back and pushes off with rear foot
  - Recovery: 0.40~0.80s — Regains balance
- Attack Direction: None
- Notes: Reference for invincibility frame window setup.

---

## PunchDamageAnimation01

- Asset ID: ovdrassetid://18175100
- Category: Hit Reaction
- Duration: 0.40s
- Motion: Light hit reaction — upper body flinches right from a left-side hit
- Phases:
  - Hit reaction: 0.00~0.15s — Impact pushes upper body right
  - Recovery: 0.15~0.40s — Returns to fighting stance
- Attack Direction: None

---

## PunchDamageAnimation02

- Asset ID: ovdrassetid://18176100
- Category: Hit Reaction
- Duration: 0.40s
- Motion: Light hit reaction — upper body flinches left from a right-side hit
- Phases:
  - Hit reaction: 0.00~0.15s — Impact pushes upper body left
  - Recovery: 0.15~0.40s — Returns to fighting stance
- Attack Direction: None
- Notes: Opposite direction variant of Damage01.

---

## PunchDamageAnimation03

- Asset ID: ovdrassetid://18178100
- Category: Hit Reaction
- Duration: 0.33s
- Motion: Short hit reaction — head snaps backward from a frontal hit
- Phases:
  - Hit reaction: 0.00~0.12s — Head snaps backward
  - Recovery: 0.12~0.33s — Returns to stance
- Attack Direction: None
- Notes: Shortest hit reaction. For quick stagger during consecutive hits.

---

## PunchKnockbackAnimation01

- Asset ID: ovdrassetid://18179200
- Category: Hit Reaction
- Duration: 0.66s
- Motion: Knockback reaction — body pushed back significantly with arms spread
- Phases:
  - Knockback: 0.00~0.30s — Impact pushes upper body back, arms spread
  - Recovery: 0.30~0.66s — Staggers to regain balance
- Attack Direction: None
- Notes: For heavy hits with knockback effects.

---

## PunchKickAttackStrongAnimation

- Asset ID: ovdrassetid://20476600
- Category: Attack
- Duration: 0.70s
- Motion: Powerful front kick lifting right knee high then extending forward forcefully
- Phases:
  - Anticipation: 0.00~0.20s — Lifts right knee to chest height
  - Impact: 0.20~0.38s — Right foot extends forward forcefully
  - Recovery: 0.38~0.70s — Retracts foot and returns to stance
- Attack Direction: Forward horizontal (Front kick)
- Notes: Strong kick skill. Suitable for knockback judgment.

---

## PunchKickAttackMultipleAnimation

- Asset ID: ovdrassetid://20476400
- Category: Attack
- Duration: 0.60s
- Motion: Axe kick lifting right foot high and slamming it down from above
- Phases:
  - Anticipation: 0.00~0.15s — Lifts right foot to head height
  - Impact: 0.15~0.35s — Slams foot vertically downward
  - Recovery: 0.35~0.60s — Returns to stance
- Attack Direction: Top-to-bottom (Axe kick)
- Notes: Can chain into down attack.

---

## PunchAttackMultipleAnimation

- Asset ID: ovdrassetid://20476900
- Category: Attack
- Duration: 0.26s
- Motion: Ultra-fast rapid punches alternating both fists (loopable)
- Attack Direction: Forward horizontal (Rapid fire)
- Notes: Loop playback for multi-hit continuous striking.

---

## PunchAttackStrongAnimation

- Asset ID: ovdrassetid://20479100
- Category: Attack
- Duration: 1.00s
- Motion: Heavy smash punch — pulls right fist far back then charges forward with full body weight
- Phases:
  - Anticipation: 0.00~0.30s — Steps back, pulls right arm far behind
  - Charge+Impact: 0.30~0.55s — Charges forward, drives right fist forcefully
  - Recovery: 0.55~1.00s — Recovers from forward momentum
- Attack Direction: Forward horizontal (Charge smash)
- Notes: High power, long wind-up. Motion involves forward charge.

---

## PunchHitGroundAnimation

- Asset ID: ovdrassetid://20478700
- Category: Attack
- Duration: 1.56s
- Motion: Ground pound — raises both fists high then slams them into the ground
- Phases:
  - Anticipation: 0.00~0.40s — Raises both fists above head
  - Impact: 0.40~0.70s — Slams both fists into the ground
  - Shockwave+Recovery: 0.70~1.56s — Recovers slowly after ground impact
- Attack Direction: Top-to-bottom (Ground slam)
- Notes: AoE skill. Combine with ground shockwave effects. Long end lag.

---

## PunchStompAnimation

- Asset ID: ovdrassetid://20479300
- Category: Attack
- Duration: 0.66s
- Motion: Stomp attack lifting right foot high and slamming down on a target below
- Phases:
  - Anticipation: 0.00~0.18s — Lifts right knee high
  - Impact: 0.18~0.35s — Slams right foot straight down
  - Recovery: 0.35~0.66s — Returns to stance
- Attack Direction: Top-to-bottom (Stomp)
- Notes: Follow-up attack on downed enemies.

---

## PunchWhirlwindAnimation

- Asset ID: ovdrassetid://20479500
- Category: Skill
- Duration: 0.23s
- Motion: Whirlwind attack spinning rapidly in place with arms spread (loopable)
- Attack Direction: 360-degree omnidirectional (Spin)
- Notes: Loop playback for sustained spinning AoE.

---

## PunchAirDamageBackLoopAnimation

- Asset ID: ovdrassetid://23658100
- Category: Hit Reaction
- Duration: 1.36s
- Motion: Air hit reaction loop falling backward with back facing down while airborne
- Attack Direction: None
- Notes: Air combo hit reaction (backward). Loop until landing.

---

## PunchAirDamageLoopAnimation

- Asset ID: ovdrassetid://23659200
- Category: Hit Reaction
- Duration: 1.30s
- Motion: Air hit reaction loop with belly facing down and limbs spread while airborne
- Attack Direction: None
- Notes: Air combo hit reaction (forward). Alternate with AirDamageBackLoop.

---

## PunchKnockdownStartAnimation

- Asset ID: ovdrassetid://23661100
- Category: Hit Reaction
- Duration: 1.06s
- Motion: Knockdown start — body sent flying backward and falls onto back
- Phases:
  - Sent flying: 0.00~0.40s — Impact sends body flying backward
  - Landing: 0.40~0.70s — Falls onto back
  - Bounce: 0.70~1.06s — Bounces slightly then goes prone
- Attack Direction: None
- Notes: Knockdown trilogy 1/3. Connects to KnockdownLoop → KnockdownEnd.

---

## PunchKnockdownLoopAnimation

- Asset ID: ovdrassetid://23662200
- Category: Hit Reaction
- Duration: 0.80s
- Motion: Knockdown hold loop lying on back with subtle twitching
- Attack Direction: None
- Notes: Knockdown trilogy 2/3. Loop during down time.

---

## PunchKnockdownEndAnimation

- Asset ID: ovdrassetid://23662400
- Category: Hit Reaction
- Duration: 1.26s
- Motion: Get-up motion rising from ground and staggering back to fighting stance
- Phases:
  - Get up: 0.00~0.60s — Pushes off ground with arms to stand
  - Recovery: 0.60~1.26s — Staggers to feet
- Attack Direction: None
- Notes: Knockdown trilogy 3/3.
