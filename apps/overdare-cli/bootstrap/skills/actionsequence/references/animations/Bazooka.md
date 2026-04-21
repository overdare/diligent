# Bazooka Animation Catalog

Asset Package: BazookaAnimations
Weapon Type: Bazooka
Purpose: TPS Bazooka Combat System

---

## BazookaIdleAnimation

- Asset ID: ovdrassetid://18207300
- Category: Idle
- Duration: 1.20s
- Motion: Combat idle with bazooka resting on right shoulder, held with one hand
- Attack Direction: None

---

## BazookaAttackAnimation

- Asset ID: ovdrassetid://18206100
- Category: Attack
- Duration: 0.80s
- Motion: Firing motion with bazooka braced on shoulder, launching a rocket forward
- Phases:
  - Aim: 0.00~0.20s — Braces bazooka against shoulder and aims
  - Fire: 0.20~0.35s — Fires rocket, backblast recoil
  - Recovery: 0.35~0.80s — Absorbs recoil and returns to idle stance
- Attack Direction: Forward straight (Rocket shot)
- Notes: Heavy recoil and slow fire rate.

---

## BazookaJumpAttackAnimation

- Asset ID: ovdrassetid://18208100
- Category: Attack
- Duration: 0.63s
- Motion: Jump attack firing rocket from the air with bazooka angled slightly downward
- Phases:
  - Aim+Fire: 0.00~0.25s — Fires slightly downward from the air
  - Recoil+Fall: 0.25~0.63s — Body pushed back by recoil, transitions to falling pose
- Attack Direction: Forward slightly downward (Aerial shot)

---

## BazookaEquipAnimation

- Asset ID: ovdrassetid://18207100
- Category: Utility
- Duration: 0.46s
- Motion: Draws bazooka from back and places it on shoulder
- Attack Direction: None

---

## BazookaUnequipAnimation

- Asset ID: ovdrassetid://18208200
- Category: Utility
- Duration: 0.46s
- Motion: Takes bazooka off shoulder and stores it on back
- Attack Direction: None
