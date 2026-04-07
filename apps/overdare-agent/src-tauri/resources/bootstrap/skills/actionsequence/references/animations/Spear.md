# Spear Animation Catalog

Asset Package: SpearAnimations
Weapon Type: Spear
Purpose: TPA Spear Combat System

---

## SpearIdleAnimation

- Asset ID: ovdrassetid://18202400
- Category: Idle
- Duration: 1.20s
- Motion: Combat idle stance holding a long spear diagonally in front of body with both hands
- Attack Direction: None

---

## SpearAttackAnimation01

- Asset ID: ovdrassetid://18201100
- Category: Attack
- Duration: 0.70s
- Motion: Pulls spear back then thrusts it forward quickly in a straight stab
- Phases:
  - Anticipation: 0.00~0.18s — Pulls spear back to prepare
  - Impact: 0.18~0.38s — Pushes spear forward quickly with both hands
  - Recovery: 0.38~0.70s — Pulls spear back and returns to stance
- Attack Direction: Forward straight (Thrust)
- Notes: Combo hit 1. Quick thrust.

---

## SpearAttackAnimation02

- Asset ID: ovdrassetid://18202200
- Category: Attack
- Duration: 0.93s
- Motion: Holds spear horizontally and sweeps it wide from the side inward
- Phases:
  - Anticipation: 0.00~0.25s — Extends spear to the side
  - Impact: 0.25~0.50s — Spear sweeps horizontally across a wide area
  - Recovery: 0.50~0.93s — Returns spear to stance
- Attack Direction: Left-to-right horizontal (Horizontal sweep)
- Notes: Combo hit 2. Wide-range horizontal swing.

---

## SpearJumpAttackAnimation

- Asset ID: ovdrassetid://18204100
- Category: Attack
- Duration: 0.63s
- Motion: Jump attack pointing spear downward while airborne and plunging down to stab
- Phases:
  - Preparation: 0.00~0.15s — Points spear tip downward in the air
  - Impact: 0.15~0.35s — Plunges downward thrusting spear below
  - Recovery: 0.35~0.63s — Lands, withdraws spear, returns to stance
- Attack Direction: Top-to-bottom (Plunge thrust)

---

## SpearEquipAnimation

- Asset ID: ovdrassetid://18202300
- Category: Utility
- Duration: 0.80s
- Motion: Draws spear from behind the back and grips it with both hands
- Attack Direction: None

---

## SpearUnequipAnimation

- Asset ID: ovdrassetid://18202700
- Category: Utility
- Duration: 0.46s
- Motion: Returns spear to the back for storage
- Attack Direction: None

---

## SpearDefenseAnimation

- Asset ID: ovdrassetid://20472100
- Category: Defense
- Duration: 0.53s
- Motion: Defense stance holding spear horizontally in front of body to block
- Attack Direction: None

---

## SpearPierceAnimation

- Asset ID: ovdrassetid://20473100
- Category: Skill
- Duration: 0.50s
- Motion: Pulls spear far back then charges forward with a powerful thrust
- Phases:
  - Anticipation: 0.00~0.12s — Pulls spear far back
  - Impact: 0.12~0.28s — Drives spear forward with full body weight
  - Recovery: 0.28~0.50s — Withdraws spear and returns to stance
- Attack Direction: Forward straight (Power thrust)
- Notes: Higher power than Attack01 with forward charge.

---

## SpearSpinAttackAnimation

- Asset ID: ovdrassetid://23668200
- Category: Skill
- Duration: 1.10s
- Motion: Spin attack rapidly rotating spear like a propeller to sweep the area ahead
- Phases:
  - Anticipation: 0.00~0.25s — Grips spear in spin-ready position
  - Spin attack: 0.25~0.80s — Rapidly spins spear for wide-area forward strikes
  - Recovery: 0.80~1.10s — Stops spinning and returns to stance
- Attack Direction: Forward AoE (Spin)

---

## SpearLowerAttackAnimation

- Asset ID: ovdrassetid://23667100
- Category: Skill
- Duration: 1.33s
- Motion: Raises spear high then slams it down forcefully in a powerful downward strike
- Phases:
  - Anticipation: 0.00~0.35s — Raises spear high above head
  - Impact: 0.35~0.65s — Slams spear vertically downward
  - Aftermath+Recovery: 0.65~1.33s — Withdraws spear and slowly returns to stance
- Attack Direction: Top-to-bottom (Downward slam)
- Notes: High power, long wind-up and end lag.

---

## SpearRunAnimation

- Asset ID: ovdrassetid://20474100
- Category: Movement
- Duration: 0.66s
- Motion: Running forward while holding spear diagonally in front with both hands
- Attack Direction: None
