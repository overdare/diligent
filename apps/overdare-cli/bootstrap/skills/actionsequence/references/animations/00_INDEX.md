# Animation Catalog Index

This folder is a catalog that organizes visual information of Overdare animation assets by category.
When the AI creates or modifies action sequences, it reads only the necessary category files to save tokens.

All animations have no root motion (played in place).

---

## Category List

| File | Category | Asset Package | Description | Animation Count |
|---|---|---|---|---|
| [Basic.md](Basic.md) | Basic | BasicAnimations | Basic movement (walk/run/jump), basic attack, dash, etc. | 11 |
| [State.md](State.md) | State | BasicStateAnimations | Hit, guard, stun, death, climbing, and other state reactions | 7 |
| [Swim.md](Swim.md) | Swim | BasicSwimAnimations | Swimming related (breaststroke, freestyle, diving, etc.) | 7 |
| [Melee.md](Melee.md) | Melee | BasicMeleeAnimations | TPA melee combat basic motions (movement/jump/attack) | 7 |
| [Punch.md](Punch.md) | Punch | PunchAnimations | Fist combat (attack combos, kicks, hit reactions, knockdowns, dodges) | 25 |
| [Sword.md](Sword.md) | Sword | SwordAnimations | One-handed sword combat (attack combos, thrust, upward slash, spin) | 12 |
| [TwoHandedSword.md](TwoHandedSword.md) | TwoHandedSword | TwoHandedSwordAnimations | Two-handed sword combat (attack, downward slash, upward slash, aerial spin) | 13 |
| [Bow.md](Bow.md) | Bow | BowAnimations | Bow combat (charging, firing, heavy attack) | 8 |
| [Spear.md](Spear.md) | Spear | SpearAnimations | Spear combat (attack, thrust, spin attack, ground slam) | 11 |
| [Handgun.md](Handgun.md) | Handgun | BasicHandgunAnimations | Handgun TPS (movement, shooting, reload, boost) | 11 |
| [Rifle.md](Rifle.md) | Rifle | BasicRifleAnimations | Rifle TPS (movement, shooting, reload, boost) | 11 |
| [Shotgun.md](Shotgun.md) | Shotgun | ShotgunAnimations | Shotgun TPS (movement, shooting, reload, chambering) | 12 |
| [Bazooka.md](Bazooka.md) | Bazooka | BazookaAnimations | Bazooka (shooting, jump attack) | 5 |
| [Obby.md](Obby.md) | Obby | OBBYAnimations | Obstacles/special movement (balance, rope, roll, hang, crawl, push, etc.) | 23 |
| [Life.md](Life.md) | Life | BasicLifeAnimations etc. | Lifestyle/emotions (sit, eat, talk, victory/defeat/draw, warm-up) | 18 |
| [Etc.md](Etc.md) | Etc | Mixed | Push, lift, skill cast, throw, grab, revive, and other miscellaneous | 18 |

---

## How to Use

1. Read this INDEX first.
2. Determine the category of the animation you need.
3. Read only the corresponding category MD file.

### Category Selection Guide

- **Unarmed combat/combo setup** → Punch.md
- **One-handed sword combat** → Sword.md
- **Two-handed sword combat** → TwoHandedSword.md
- **Spear combat** → Spear.md
- **Bow combat** → Bow.md
- **Firearm combat** → Handgun.md / Rifle.md / Shotgun.md / Bazooka.md
- **Hit/death/stun reactions** → State.md (+ Punch.md also has punch-specific hit reactions)
- **Basic movement/jump** → Basic.md
- **Movement while holding a weapon** → Melee.md (unarmed/general), each weapon category also includes movement
- **Obstacle course/special movement** → Obby.md
- **Lifestyle/emotion expressions** → Life.md
- **Others (throw, grab, push, etc.)** → Etc.md
