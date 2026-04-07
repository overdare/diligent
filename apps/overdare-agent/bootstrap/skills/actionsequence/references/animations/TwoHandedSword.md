# TwoHandedSword Animation Catalog

Asset Package: TwoHandedSwordAnimations
Weapon Type: Two-handed Sword
Purpose: TPA Two-handed Sword Combat System

---

## TwoHandedSwordIdleAnimation

- Asset ID: ovdrassetid://18188100
- Category: Idle
- Duration: 1.20s
- Motion: Combat idle stance holding a large sword upright in front of body with both hands
- Attack Direction: None

---

## TwoHandedSwordAttackAnimation01

- Asset ID: ovdrassetid://18190100
- Category: Attack
- Duration: 0.86s
- Motion: Raises two-handed sword behind right shoulder then delivers a diagonal downward slash
- Phases:
  - Anticipation: 0.00~0.25s — Raises sword high above right shoulder
  - Impact: 0.25~0.48s — Sword comes down in an upper-right to lower-left diagonal
  - Recovery: 0.48~0.86s — Returns to stance
- Attack Direction: Upper-right to lower-left diagonal (Diagonal slash)
- Notes: Combo hit 1. Heavy and powerful first strike.

---

## TwoHandedSwordAttackAnimation02

- Asset ID: ovdrassetid://18192100
- Category: Attack
- Duration: 0.86s
- Motion: Raises two-handed sword high overhead then delivers a strong vertical downward slash
- Phases:
  - Anticipation: 0.00~0.25s — Raises sword with both hands above head
  - Impact: 0.25~0.48s — Sword comes down in a vertical top-to-bottom strike
  - Recovery: 0.48~0.86s — Returns to stance
- Attack Direction: Top-to-bottom vertical (Vertical slash)
- Notes: Combo hit 2. Powerful vertical slash.

---

## TwoHandedSwordAttackAnimation03

- Asset ID: ovdrassetid://18193100
- Category: Attack
- Duration: 0.86s
- Motion: Sweeps two-handed sword wide from left to right in a reverse horizontal slash
- Phases:
  - Anticipation: 0.00~0.25s — Twists upper body left, brings sword behind
  - Impact: 0.25~0.48s — Hip rotation swings sword wide from left to right
  - Recovery: 0.48~0.86s — Returns to stance
- Attack Direction: Left-to-right horizontal (Wide horizontal slash)
- Notes: Combo hit 3 (Finisher). Wide-range finishing attack.

---

## TwoHandedSwordJumpAttackAnimation

- Asset ID: ovdrassetid://18195100
- Category: Attack
- Duration: 0.43s
- Motion: Raises two-handed sword overhead while airborne then slams it down forcefully
- Phases:
  - Preparation: 0.00~0.10s — Raises sword above head in the air
  - Impact: 0.10~0.25s — Slams sword vertically downward
  - Recovery: 0.25~0.43s — Lands and returns to stance
- Attack Direction: Top-to-bottom (Aerial slam)

---

## TwoHandedSwordEquipAnimation

- Asset ID: ovdrassetid://18189300
- Category: Utility
- Duration: 0.90s
- Motion: Draws two-handed sword from behind the back and grips it with both hands
- Attack Direction: None

---

## TwoHandedSwordUnequipAnimation

- Asset ID: ovdrassetid://18193300
- Category: Utility
- Duration: 0.63s
- Motion: Returns two-handed sword to the back for storage
- Attack Direction: None

---

## TwoHandedSwordDefenseAnimation

- Asset ID: ovdrassetid://20466100
- Category: Defense
- Duration: 0.80s
- Motion: Defense stance holding two-handed sword diagonally in front of body to block
- Phases:
  - Guard enter: 0.00~0.15s — Raises sword diagonally in front
  - Guard hold: 0.15~0.60s — Maintains blocking stance
  - Guard release: 0.60~0.80s — Lowers sword and returns to combat stance
- Attack Direction: None

---

## TwoHandedSwordUpperAttackAnimation

- Asset ID: ovdrassetid://20470200
- Category: Skill
- Duration: 0.63s
- Motion: Sweeps two-handed sword upward from below in a large rising slash
- Phases:
  - Anticipation: 0.00~0.16s — Bends knees and lowers sword
  - Impact: 0.16~0.36s — Extends legs while sword rises in a large arc
  - Recovery: 0.36~0.63s — Returns to stance
- Attack Direction: Bottom-to-top (Rising slash)
- Notes: Suitable for launch judgment.

---

## TwoHandedSwordLowerAttackAnimation

- Asset ID: ovdrassetid://20470100
- Category: Skill
- Duration: 0.66s
- Motion: Sweeps two-handed sword downward from the side in a low slash
- Phases:
  - Anticipation: 0.00~0.18s — Raises sword to the side
  - Impact: 0.18~0.38s — Sword traces a side-to-down trajectory
  - Recovery: 0.38~0.66s — Returns to stance
- Attack Direction: Top-to-bottom diagonal (Low sweep)
- Notes: For follow-up attacks on downed enemies.

---

## TwoHandedSwordWhirlwindAnimation

- Asset ID: ovdrassetid://20470300
- Category: Skill
- Duration: 0.26s
- Motion: Ground whirlwind slash spinning rapidly in place with two-handed sword extended (loopable)
- Attack Direction: 360-degree omnidirectional (Spin slash)
- Notes: Loop playback for sustained spinning. Wide AoE thanks to long reach.

---

## TwoHandedSwordAirWhirlwindAttackAnimation

- Asset ID: ovdrassetid://20468100
- Category: Skill
- Duration: 0.60s
- Motion: Leaps into the air and performs a spinning slash with two-handed sword
- Phases:
  - Leap: 0.00~0.15s — Jumps into the air
  - Aerial spin+Impact: 0.15~0.40s — Extends sword and spins in the air
  - Landing: 0.40~0.60s — Lands and returns to stance
- Attack Direction: 360-degree omnidirectional (Aerial spin)
- Notes: Can combine with AirWhirlwindLoop for sustained airborne effect.

---

## TwoHandedSwordAirWhirlwindLoopAnimation

- Asset ID: ovdrassetid://23664100
- Category: Skill
- Duration: 0.20s
- Motion: Aerial whirlwind loop continuing to spin with two-handed sword extended in the air (loopable)
- Attack Direction: 360-degree omnidirectional (Aerial spin)
- Notes: Connects after AirWhirlwindAttack. Loop for sustained airborne spinning.
