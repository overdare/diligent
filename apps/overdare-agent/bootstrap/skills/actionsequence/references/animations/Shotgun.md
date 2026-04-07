# Shotgun Animation Catalog

Asset Package: ShotgunAnimations
Weapon Type: Shotgun
Purpose: TPS Shotgun Combat System
Default Stance: Two-handed grip holding the shotgun with both hands.

---

## ShotgunIdleAnimation

- Asset ID: ovdrassetid://18653100
- Category: Idle
- Duration: 1.73s
- Motion: TPS combat idle watching forward with shotgun held in both hands
- Attack Direction: None

---

## ShotgunWalkAnimation

- Asset ID: ovdrassetid://18654200
- Category: Movement
- Duration: 0.93s
- Motion: Combat walk moving forward with shotgun held in both hands
- Attack Direction: None

---

## ShotgunRunAnimation

- Asset ID: ovdrassetid://18656100
- Category: Movement
- Duration: 0.66s
- Motion: Combat run moving forward with shotgun aimed ahead in two-handed grip
- Attack Direction: None

---

## ShotgunJumpStartAnimation

- Asset ID: ovdrassetid://18663100
- Category: Movement
- Duration: 0.70s
- Motion: Jump start motion with shotgun held in both hands
- Attack Direction: None

---

## ShotgunJumpLoopAnimation

- Asset ID: ovdrassetid://18664100
- Category: Movement
- Duration: 0.80s
- Motion: Jump loop hovering in the air with shotgun held in both hands
- Attack Direction: None

---

## ShotgunJumpEndAnimation

- Asset ID: ovdrassetid://18663200
- Category: Movement
- Duration: 0.70s
- Motion: Landing motion with shotgun held in both hands
- Attack Direction: None

---

## ShotgunFireAnimation

- Asset ID: ovdrassetid://18656400
- Category: Attack
- Duration: 0.73s
- Motion: Firing motion with shotgun shouldered, shooting forward with heavy recoil
- Phases:
  - Fire: 0.00~0.12s — Pulls trigger to fire
  - Recoil: 0.12~0.40s — Heavy recoil kicks muzzle upward
  - Recovery: 0.40~0.73s — Returns to aim stance
- Attack Direction: Forward straight (Buckshot)
- Notes: More recoil and slower than handgun/rifle.

---

## ShotgunReloadAnimation

- Asset ID: ovdrassetid://18668100
- Category: Utility
- Duration: 2.20s
- Motion: Full reload motion opening shotgun, inserting shells, and closing
- Phases:
  - Open: 0.00~0.60s — Opens shotgun or prepares pump
  - Load: 0.60~1.60s — Inserts shells
  - Close: 1.60~2.20s — Closes shotgun and returns to combat stance
- Attack Direction: None

---

## ShotgunLoadAnimation

- Asset ID: ovdrassetid://18666100
- Category: Utility
- Duration: 0.50s
- Motion: Single shell load motion pushing one shell into the shotgun
- Attack Direction: None
- Notes: Loop playback for loading multiple shells.

---

## ShotgunBoostAnimation

- Asset ID: ovdrassetid://18660300
- Category: Movement
- Duration: 0.23s
- Motion: Dash loop boosting forward quickly with shotgun held in both hands
- Attack Direction: None

---

## ShotgunEquipAnimation

- Asset ID: ovdrassetid://18669100
- Category: Utility
- Duration: 0.46s
- Motion: Draws shotgun from back and grips with both hands
- Attack Direction: None

---

## ShotgunUnequipAnimation

- Asset ID: ovdrassetid://18669200
- Category: Utility
- Duration: 0.50s
- Motion: Stores shotgun on back
- Attack Direction: None
