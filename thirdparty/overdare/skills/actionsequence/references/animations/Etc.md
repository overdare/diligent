# Etc Animation Catalog

Asset Package: Mixed (BasicPushAnimations, BasicCarryAnimations, BasicSkillAnimations, SportsAnimations, BattleAnimations, etc.)
Purpose: Push, carry, skill cast, throw, grab, revive, and other miscellaneous motions

---

## BasicPushingAnimation

- Asset ID: ovdrassetid://18869100
- Asset Package: BasicPushAnimations
- Category: Utility
- Duration: 2.06s
- Motion: Push idle with both hands pressing forward against a heavy object
- Attack Direction: None
- Notes: Paired with PushWalk.

---

## BasicPushWalkAnimation

- Asset ID: ovdrassetid://18870200
- Asset Package: BasicPushAnimations
- Category: Movement
- Duration: 0.93s
- Motion: Walking forward while pushing a heavy object with both hands
- Attack Direction: None

---

## BasicCarryAnimation

- Asset ID: ovdrassetid://18872100
- Asset Package: BasicCarryAnimations
- Category: Utility
- Duration: 1.80s
- Motion: Holding an object forward with left hand in a torch-like grip
- Attack Direction: None
- Notes: Paired with CarryRun.

---

## BasicCarryRunAnimation

- Asset ID: ovdrassetid://18873200
- Asset Package: BasicCarryAnimations
- Category: Movement
- Duration: 0.66s
- Motion: Running while holding an object in left hand
- Attack Direction: None

---

## BasicSkill_Directed_IdleAnimation

- Asset ID: ovdrassetid://18883100
- Asset Package: BasicSkillAnimations
- Category: Skill
- Duration: 1.36s
- Motion: Idle stance with magic energy gathered in right hand, held close to body without extending arm forward
- Attack Direction: None
- Notes: Directional skill idle. Connects to Directed_Throw.

---

## BasicSkill_Directed_ThrowAnimation

- Asset ID: ovdrassetid://18885100
- Asset Package: BasicSkillAnimations
- Category: Skill
- Duration: 0.66s
- Motion: Extends right hand forward to throw a magic projectile from idle stance
- Phases:
  - Anticipation: 0.00~0.15s — Pulls right arm back to gather force
  - Impact: 0.15~0.35s — Thrusts right hand forward forcefully to throw
  - Recovery: 0.35~0.66s — Returns to stance
- Attack Direction: Forward straight (Throw)
- Notes: Projectile spawn at ~0.20s. Plays after Directed_Idle.

---

## BasicSkill_InstantAnimation

- Asset ID: ovdrassetid://18884200
- Asset Package: BasicSkillAnimations
- Category: Skill
- Duration: 0.73s
- Motion: Self-buff cast gathering energy by pulling both fists in front of body
- Phases:
  - Cast: 0.00~0.30s — Both fists drawn inward, pulling up energy
  - Recovery: 0.30~0.73s — Energy disperses, returns to stance
- Attack Direction: None
- Notes: Instant buff/self-enhancement skill.

---

## PullLeverAnimation

- Asset ID: ovdrassetid://18875100
- Asset Package: PullLeverAnimation
- Category: Utility
- Duration: 0.60s
- Motion: Grabs a lever with one hand and pulls it downward
- Attack Direction: None

---

## ThrowBallAnimation

- Asset ID: ovdrassetid://20481200
- Asset Package: SportsAnimations
- Category: Utility
- Duration: 0.96s
- Motion: Sidearm throw hurling a ball forward like a baseball pitch
- Phases:
  - Anticipation: 0.00~0.25s — Pulls throwing arm back with weight shift
  - Throw: 0.25~0.50s — Swings arm forward from the side to throw
  - Recovery: 0.50~0.96s — Lowers arm, returns to stance
- Attack Direction: Forward (Throw)

---

## SwingBatAnimation

- Asset ID: ovdrassetid://20481100
- Asset Package: SportsAnimations
- Category: Attack
- Duration: 0.93s
- Motion: Two-handed horizontal bat swing from side to forward
- Phases:
  - Anticipation: 0.00~0.25s — Pulls bat back
  - Swing: 0.25~0.50s — Swings bat horizontally with force
  - Recovery: 0.50~0.93s — Returns to stance
- Attack Direction: Left-to-right horizontal (Swing)
- Notes: Usable as sports or weapon attack.

---

## ThrowShurikenAnimation

- Asset ID: ovdrassetid://20486100
- Asset Package: BattleAnimations
- Category: Attack
- Duration: 0.20s
- Motion: Ultra-fast one-handed shuriken throw with a wrist snap
- Attack Direction: Forward straight (Projectile)

---

## ChargeEnergyAnimation

- Asset ID: ovdrassetid://20486300
- Asset Package: BattleAnimations
- Category: Skill
- Duration: 1.33s
- Motion: Power-up motion clenching both fists and tensing entire body to charge energy
- Phases:
  - Charge: 0.00~1.00s — Both fists clenched, full body tension (loopable)
  - Release: 1.00~1.33s — Releases tension and returns to stance
- Attack Direction: None
- Notes: Power-up/buff cast.

---

## GrabAnimation

- Asset ID: ovdrassetid://20481400
- Asset Package: BattleAnimations
- Category: Attack
- Duration: 1.00s
- Motion: Grabs a target and lifts them overhead with both hands
- Phases:
  - Lift: 0.00~0.30s — Grabs target and lifts overhead
  - Hold: 0.30~1.00s — Maintains overhead hold
- Attack Direction: None
- Notes: Grab idle. Connects to ThrowAnimation.

---

## BeGrabAnimation

- Asset ID: ovdrassetid://20484100
- Asset Package: BattleAnimations
- Category: Hit Reaction
- Duration: 0.40s
- Motion: Grabbed reaction — body stiffens from being seized by an opponent
- Attack Direction: None
- Notes: Counterpart to GrabAnimation.

---

## ThrowAnimation

- Asset ID: ovdrassetid://20485100
- Asset Package: BattleAnimations
- Category: Attack
- Duration: 0.43s
- Motion: Hurls a held target forward from overhead position
- Phases:
  - Throw: 0.00~0.25s — Throws target forward from overhead
  - Recovery: 0.25~0.43s — Returns to stance
- Attack Direction: Forward (Throw)
- Notes: Follows Grab → Throw sequence.

---

## FireballAnimation

- Asset ID: ovdrassetid://20486400
- Asset Package: BattleAnimations
- Category: Skill
- Duration: 0.76s
- Motion: Gathers energy in both hands then thrusts them forward to launch a fireball
- Phases:
  - Anticipation: 0.00~0.20s — Pulls both hands to sides to concentrate energy
  - Impact: 0.20~0.40s — Pushes both hands forward to fire
  - Recovery: 0.40~0.76s — Returns to stance
- Attack Direction: Forward straight (Projectile)
- Notes: Projectile spawn at ~0.25s.

---

## ResurrectionAnimation

- Asset ID: ovdrassetid://20486600
- Asset Package: BattleAnimations
- Category: State
- Duration: 1.93s
- Motion: Rises from a crouched position into the air, spreads limbs wide, looks skyward
- Phases:
  - Ascend: 0.00~0.80s — Floats upward from crouched position, spreading limbs
  - Peak: 0.80~1.40s — Body fully extended, head tilted up at apex
  - Descend: 1.40~1.93s — Descends and returns to basic stance
- Attack Direction: None
- Notes: Resurrection/awakening cinematic.

---

## HeroLandingAnimation

- Asset ID: ovdrassetid://20487200
- Asset Package: BattleAnimations
- Category: Utility
- Duration: 1.66s
- Motion: Superhero landing — impacts ground with one knee and one fist
- Phases:
  - Land: 0.00~0.40s — Slams down on one knee and one fist
  - Pose: 0.40~0.80s — Holds landing pose
  - Rise: 0.80~1.66s — Slowly stands up
- Attack Direction: None
