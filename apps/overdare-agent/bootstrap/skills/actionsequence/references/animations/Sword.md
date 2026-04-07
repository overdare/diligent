# Sword Animation Catalog

Asset Package: SwordAnimations
Weapon Type: One-handed Sword
Purpose: TPA One-handed Sword Combat System

---

## SwordIdleAnimation

- Asset ID: ovdrassetid://18182100
- Category: Idle
- Duration: 1.06s
- Motion: Combat idle stance holding sword in right hand naturally lowered
- Attack Direction: None

---

## SwordAttackAnimation01

- Asset ID: ovdrassetid://18182200
- Category: Attack
- Duration: 0.56s
- Motion: Basic horizontal slash swinging quickly from right to left
- Phases:
  - Anticipation: 0.00~0.12s — Pulls sword back to the right
  - Impact: 0.12~0.28s — Sword traces a horizontal arc from right to left
  - Recovery: 0.28~0.56s — Returns sword to position
- Attack Direction: Right-to-left horizontal (Horizontal slash)
- Notes: Combo hit 1. Fast basic slash.

---

## SwordAttackAnimation02

- Asset ID: ovdrassetid://18184100
- Category: Attack
- Duration: 0.70s
- Motion: Raises sword high then delivers a diagonal downward slash from upper-right to lower-left
- Phases:
  - Anticipation: 0.00~0.18s — Raises sword high above head
  - Impact: 0.18~0.38s — Sword comes down in a diagonal strike
  - Recovery: 0.38~0.70s — Returns to stance
- Attack Direction: Upper-right to lower-left diagonal (Downward slash)
- Notes: Combo hit 2. Larger and stronger than hit 1.

---

## SwordAttackAnimation03

- Asset ID: ovdrassetid://18184200
- Category: Attack
- Duration: 0.83s
- Motion: Slight jump while twisting body wide from left to right for a jumping reverse horizontal slash
- Phases:
  - Anticipation+Leap: 0.00~0.22s — Slight jump, twists body left, brings sword behind
  - Aerial Impact: 0.22~0.45s — Hip rotation swings sword wide from left to right
  - Landing+Recovery: 0.45~0.83s — Lands and returns to position
- Attack Direction: Left-to-right horizontal (Jump reverse horizontal slash)
- Notes: Combo hit 3. Opposite direction of hit 1, wide range.

---

## SwordAttackAnimation04

- Asset ID: ovdrassetid://18186200
- Category: Attack
- Duration: 0.90s
- Motion: Leaps up with sword pulled far back and performs a 360-degree spin slash in the air
- Phases:
  - Anticipation+Leap: 0.00~0.25s — Jumps and pulls sword behind
  - Aerial spin+Impact: 0.25~0.55s — Full 360-degree rotation with sword tracing a wide arc
  - Landing+Recovery: 0.55~0.90s — Lands and recovers
- Attack Direction: Forward rotation (Jump 360-degree spin slash)
- Notes: Combo hit 4 (Finisher). Widest range and highest power.

---

## SwordJumpAttackAnimation

- Asset ID: ovdrassetid://18182300
- Category: Attack
- Duration: 0.50s
- Motion: Raises sword overhead while airborne then slashes downward forcefully
- Phases:
  - Preparation: 0.00~0.12s — Raises sword above head in the air
  - Impact: 0.12~0.30s — Slashes sword vertically downward
  - Recovery: 0.30~0.50s — Lands and returns to stance
- Attack Direction: Top-to-bottom (Aerial downward slash)

---

## SwordEquipAnimation

- Asset ID: ovdrassetid://18186400
- Category: Utility
- Duration: 0.86s
- Motion: Reaches behind waist/back to draw sword and transition to combat stance
- Attack Direction: None

---

## SwordUnequipAnimation

- Asset ID: ovdrassetid://18186700
- Category: Utility
- Duration: 0.43s
- Motion: Sheathes sword behind waist/back
- Attack Direction: None

---

## SwordDefenseAnimation

- Asset ID: ovdrassetid://20462100
- Category: Defense
- Duration: 1.06s
- Motion: Defense stance holding sword raised forward with blade angled diagonally
- Phases:
  - Guard enter: 0.00~0.20s — Raises sword forward, blade tip pointing upper-left
  - Guard hold: 0.20~0.80s — Maintains diagonal sword guard
  - Guard release: 0.80~1.06s — Lowers sword and returns to combat stance
- Attack Direction: None

---

## SwordPierceAnimation

- Asset ID: ovdrassetid://20463200
- Category: Skill
- Duration: 0.60s
- Motion: Pulls sword to the side then thrusts it forward quickly in a straight stab
- Phases:
  - Anticipation: 0.00~0.15s — Pulls sword to the side
  - Impact: 0.15~0.32s — Sword thrusts straight forward
  - Recovery: 0.32~0.60s — Withdraws sword and returns to stance
- Attack Direction: Forward straight (Thrust)
- Notes: Narrow hitbox but fast. Use with charge forward effect.

---

## SwordUpperAttackAnimation

- Asset ID: ovdrassetid://20463400
- Category: Skill
- Duration: 0.60s
- Motion: Bends knees lowering sword then performs a rising upward slash
- Phases:
  - Anticipation: 0.00~0.15s — Bends knees and lowers sword
  - Impact: 0.15~0.35s — Extends legs while sword rises from bottom to top
  - Recovery: 0.35~0.60s — Returns to stance
- Attack Direction: Bottom-to-top (Rising slash)
- Notes: Suitable for launch judgment.

---

## SwordWhirlwindAnimation

- Asset ID: ovdrassetid://20464200
- Category: Skill
- Duration: 0.26s
- Motion: Whirlwind slash spinning rapidly in place with sword extended (loopable)
- Attack Direction: 360-degree omnidirectional (Spin slash)
- Notes: Loop playback for sustained spinning AoE.
