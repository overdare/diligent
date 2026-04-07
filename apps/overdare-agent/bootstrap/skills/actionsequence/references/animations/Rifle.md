# Rifle Animation Catalog

Asset Package: BasicRifleAnimations / FirearmsEquipAnimations
Weapon Type: Rifle
Purpose: TPS Rifle Combat System
Default Stance: Two-handed grip holding the rifle with both hands.

---

## BasicRifleIdleAnimation

- Asset ID: ovdrassetid://18604100
- Category: Idle
- Duration: 2.00s
- Motion: TPS combat idle aiming forward with rifle held in both hands
- Attack Direction: None

---

## BasicRifleWalkAnimation

- Asset ID: ovdrassetid://18606100
- Category: Movement
- Duration: 0.93s
- Motion: TPS combat walk moving forward while maintaining rifle aim
- Attack Direction: None

---

## BasicRifleRunAnimation

- Asset ID: ovdrassetid://18606300
- Category: Movement
- Duration: 0.66s
- Motion: TPS combat run moving forward with rifle aimed ahead in two-handed grip
- Attack Direction: None

---

## BasicRifleJumpAnimation

- Asset ID: ovdrassetid://18608700
- Category: Movement
- Duration: 0.70s
- Motion: Jump start leaping upward with rifle held in both hands
- Attack Direction: None

---

## BasicRifleJumpLoopAnimation

- Asset ID: ovdrassetid://18611200
- Category: Movement
- Duration: 0.80s
- Motion: Jump loop hovering in the air with rifle held in both hands
- Attack Direction: None

---

## BasicRifleLandingAnimation

- Asset ID: ovdrassetid://18612100
- Category: Movement
- Duration: 0.63s
- Motion: Landing motion absorbing impact with rifle held in both hands
- Attack Direction: None

---

## BasicRifleAttackAnimation

- Asset ID: ovdrassetid://18607800
- Category: Attack
- Duration: 0.26s
- Motion: Firing motion with rifle shouldered, shooting forward
- Phases:
  - Fire: 0.00~0.08s — Pulls trigger to fire
  - Recoil+Recovery: 0.08~0.26s — Returns to aim stance after firing recoil
- Attack Direction: Forward straight (Shot)

---

## BasicRifleReloadAnimation

- Asset ID: ovdrassetid://18608600
- Category: Utility
- Duration: 2.63s
- Motion: Rifle reload motion swapping magazine and racking the bolt
- Phases:
  - Magazine eject: 0.00~0.80s — Ejects empty magazine
  - Magazine insert: 0.80~1.80s — Inserts new magazine
  - Reload complete: 1.80~2.63s — Racks bolt and returns to aim stance
- Attack Direction: None

---

## BasicRifleBoost_F_LoopAnimation

- Asset ID: ovdrassetid://18606400
- Category: Movement
- Duration: 0.23s
- Motion: Dash loop boosting forward quickly with rifle held in both hands
- Attack Direction: None

---

## RifleEquipAnimation

- Asset ID: ovdrassetid://18571100
- Asset Package: FirearmsEquipAnimations
- Category: Utility
- Duration: 0.46s
- Motion: Draws rifle from back/side and grips with both hands
- Attack Direction: None

---

## RifleUnequipAnimation

- Asset ID: ovdrassetid://18570100
- Asset Package: FirearmsEquipAnimations
- Category: Utility
- Duration: 0.50s
- Motion: Stores rifle on back/side
- Attack Direction: None
