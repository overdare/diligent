# Bow Animation Catalog

Asset Package: BowAnimations
Weapon Type: Bow
Purpose: TPA Bow Combat System

---

## BowIdleAnimation

- Asset ID: ovdrassetid://18198200
- Category: Idle
- Duration: 1.20s
- Motion: Combat idle stance holding bow in left hand with an arrow lightly nocked in right hand
- Attack Direction: None

---

## BowChargeAnimation

- Asset ID: ovdrassetid://18198100
- Category: Attack
- Duration: 0.26s
- Motion: Charging (aiming) motion holding bow forward and drawing the string back
- Attack Direction: Forward (Aiming)
- Notes: Plays before Attack for draw animation. Hold last frame if sustained draw is needed.

---

## BowAttackAnimation

- Asset ID: ovdrassetid://18197100
- Category: Attack
- Duration: 0.46s
- Motion: Releases drawn string to fire an arrow
- Phases:
  - Fire: 0.00~0.12s — Releases string, arrow fires forward
  - Recoil+Recovery: 0.12~0.46s — Bow shakes from firing recoil, returns to idle stance
- Attack Direction: Forward straight (Shot)
- Notes: Connects as Charge → Attack sequence. Spawn projectile at ~0.00s.

---

## BowJumpAttackAnimation

- Asset ID: ovdrassetid://18199400
- Category: Attack
- Duration: 0.33s
- Motion: Jump shot firing an arrow in the air
- Phases:
  - Fire: 0.00~0.10s — Releases string in the air to fire arrow
  - Recoil+Recovery: 0.10~0.33s — Bow shakes from recoil, transitions to falling pose
- Attack Direction: Forward downward (Aerial shot)

---

## BowStrongChargeAnimation

- Asset ID: ovdrassetid://20460200
- Category: Skill
- Duration: 0.26s
- Motion: Strong attack charging in kneeling stance — right knee on ground, left leg forward, drawing string to maximum tension
- Attack Direction: Forward (Strong aim, kneeling stance)
- Notes: Plays before StrongAttack. Maximum tension charging from stable kneeling position.

---

## BowStrongAttackAnimation

- Asset ID: ovdrassetid://20459100
- Category: Skill
- Duration: 0.36s
- Motion: Strong attack fire releasing maximally drawn string from kneeling stance
- Phases:
  - Strong fire: 0.00~0.10s — Releases string at maximum tension from kneeling stance
  - Recoil+Recovery: 0.10~0.36s — Heavy firing recoil then recovery
- Attack Direction: Forward straight (Strong shot, kneeling stance)
- Notes: Sequence: StrongCharge → StrongAttack. Higher power than normal shot.

---

## BowEquipAnimation

- Asset ID: ovdrassetid://18199200
- Category: Utility
- Duration: 0.83s
- Motion: With bow already held in left hand, reaches behind to the quiver to draw an arrow
- Attack Direction: None

---

## BowUnequipAnimation

- Asset ID: ovdrassetid://18199500
- Category: Utility
- Duration: 0.46s
- Motion: Returns arrow to the quiver behind the back
- Attack Direction: None
