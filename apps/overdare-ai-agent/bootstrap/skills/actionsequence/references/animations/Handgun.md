# Handgun Animation Catalog

Asset Package: BasicHandgunAnimations / FirearmsEquipAnimations
Weapon Type: Handgun
Purpose: TPS Handgun Combat System
Default Stance: Two-handed grip wrapping both hands around the handgun.

---

## BasicHandgunIdleAnimation

- Asset ID: ovdrassetid://18558100
- Category: Idle
- Duration: 2.00s
- Motion: Combat idle aiming forward with handgun held in both hands
- Attack Direction: None

---

## BasicHandgunWalkAnimation

- Asset ID: ovdrassetid://18560100
- Category: Movement
- Duration: 0.93s
- Motion: TPS combat walk moving forward while maintaining handgun aim stance
- Attack Direction: None

---

## BasicHandgunRunAnimation

- Asset ID: ovdrassetid://18559300
- Category: Movement
- Duration: 0.66s
- Motion: TPS combat run moving forward with handgun aimed ahead in two-handed grip
- Attack Direction: None

---

## BasicHandgunJumpAnimation

- Asset ID: ovdrassetid://18563500
- Category: Movement
- Duration: 0.70s
- Motion: Jump start leaping upward with handgun held in both hands
- Attack Direction: None
- Notes: Connects to JumpLoop → Landing.

---

## BasicHandgunJumpLoopAnimation

- Asset ID: ovdrassetid://18563700
- Category: Movement
- Duration: 0.80s
- Motion: Jump loop hovering in the air with handgun held in both hands
- Attack Direction: None

---

## BasicHandgunLandingAnimation

- Asset ID: ovdrassetid://18565100
- Category: Movement
- Duration: 0.53s
- Motion: Landing motion absorbing impact with handgun held in both hands
- Attack Direction: None

---

## BasicHandgunAttackAnimation

- Asset ID: ovdrassetid://18562100
- Category: Attack
- Duration: 0.26s
- Motion: Firing motion shooting forward with handgun held in both hands
- Phases:
  - Fire: 0.00~0.08s — Pulls trigger to fire
  - Recoil+Recovery: 0.08~0.26s — Returns to aim stance after firing recoil
- Attack Direction: Forward straight (Shot)

---

## BasicHG_ReloadAnimation

- Asset ID: ovdrassetid://18563200
- Category: Utility
- Duration: 2.33s
- Motion: Handgun reload motion ejecting magazine and inserting a new one
- Phases:
  - Magazine eject: 0.00~0.70s — Ejects empty magazine
  - Magazine insert: 0.70~1.60s — Inserts new magazine
  - Reload complete: 1.60~2.33s — Racks slide and returns to combat stance
- Attack Direction: None

---

## BasicHG_Boost_F_LoopAnimaton

- Asset ID: ovdrassetid://18566100
- Category: Movement
- Duration: 0.23s
- Motion: Short dash loop boosting forward quickly with handgun held in both hands
- Attack Direction: None

---

## PistolEquipAnimation

- Asset ID: ovdrassetid://18569300
- Asset Package: FirearmsEquipAnimations
- Category: Utility
- Duration: 0.40s
- Motion: Draws handgun from hip holster and grips with both hands
- Attack Direction: None

---

## PistolUnequipAnimation

- Asset ID: ovdrassetid://18569100
- Asset Package: FirearmsEquipAnimations
- Category: Utility
- Duration: 0.40s
- Motion: Holsters handgun back into hip holster
- Attack Direction: None
