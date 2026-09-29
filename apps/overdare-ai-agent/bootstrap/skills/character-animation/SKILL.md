---
name: character-animation
description: Author or change an ODA character animation clip (emote, attack, dance, reaction) with studiorpc_animation_write, and give it an ovdrassetid with studiorpc_animation_publish when it will be used in a game. Not for choosing an existing catalog animation.
---

# Character Animation

Make a clip that a person watching it would recognise as the requested motion, with weight and timing that feel alive. The tool descriptions define the JSON, pins and preview; this skill covers what they cannot: how the ODA rig moves and what ODA's own animations look like in numbers.

## ODA rig conventions (measured)

The character faces +Y; its left is +X; up is +Z. `rotation` is `[X, Y, Z]` degrees about each bone's own axes, from the reference pose (standing straight, arms hanging slightly out). Each region's axes point differently, so the same channel does different things in different regions. A positive value does this:

| Region | X + | Y + | Z + |
|---|---|---|---|
| LowerTorso, UpperTorso01, UpperTorso02 | twists to the character's left (right shoulder forward) | leans to the character's right | bends forward |
| Head | turns to the character's left | tilts toward the right shoulder | nods down |
| UpperArm | twists the arm inward | raises the arm out to the side (65 ≈ horizontal, 155 ≈ straight up) | swings the arm forward (90 ≈ straight ahead) |
| LowerArm | twists the forearm inward | swings the forearm out, away from the body | bends the elbow |
| Hand | twists inward, like the forearm | bends the wrist back | bends the hand out, away from the body |
| UpperLeg | turns the knee outward | opens the leg out to the side | swings the leg back (negative lifts it forward) |
| LowerLeg | turns the shin outward | swings the shin out to the side (keep near 0) | bends the knee |
| Foot | turns the toes outward | rolls the sole to face outward | points the toes down (negative lifts them) |

Left and right limbs share these descriptions ("inward" means toward the body on either side), so a mirrored pose uses the same numbers on both sides. The torso and head are not mirrored: X+ always turns toward the character's left.

Move the body with LowerTorso `translation`, as ODA's own animations do; they never animate Root. Its axes are x = up, y = forward, z = the character's right, in cm. Root rotates the whole body about the feet (X+ tips forward, Y+ leans right, Z+ turns right), which is rarely what you want.

The contact sheet flattens depth, so read `preview.poseSamples` when it matters where a hand is: y forward, x left, z height, in cm.

## What ODA's own animations do (catalog, 30 fps)

Use these as a scale for amplitude and timing. They are sampled from the shipped clips:

- **Standing** (idle, 64-frame loop): never the straight reference pose. Knees bend 7–13 (LowerLeg Z), elbows 13–18, and UpperArm Z is about −19. Nothing moves more than about 5° over the loop.
- **Walk** (31-frame cycle): UpperLeg Z −46…+13, knee 27…87, UpperArm Z ±25 against the legs, torso twist ±7–10, head ±10. The hips sit 3–6 cm low, bob about 4 cm and sway 3 cm.
- **Run** (18-frame cycle): UpperLeg Z −68…+32, knee 8…136, UpperArm Z −61…+47 with elbows at 27–66. Each torso bone leans forward 5–13.
- **Strikes**: a punch takes 13 frames, a basic attack 18 and a kick 12. The hit lands on frames 4–6, and the rest is recovery. The torso twists hard into a punch (LowerTorso X −68…+31). The hips shift 10–20 cm, back to load and forward into the hit.
- **Jump and landing**: the hips move between −21 and +26 cm within 10 frames. On landing they drop up to 38 cm, with the knees at 136 by frame 5 and thighs to −100.

Joints stay within these ranges: knee 0…140, elbow 0…130, thigh lift to about −120.

## Animating

Block the story poses first (anticipation, the action's extreme, the recovery), then time them:

- Anticipation moves opposite to the action: dip before a jump, wind back before a punch.
- Fast actions take 2–4 frames. After an impact, hold for a few frames and overshoot slightly, then settle.
- The hips lead, the chest follows, and the head and arms arrive last. Arms swing against the legs.
- Use `cubic` for most keys, `linear` into an impact, and `constant` for a snap or hitstop.
- A loop repeats its first key as its last.
- Holds keep a little motion (breathing, a small drift) so they don't read as frozen.

A foot on the ground gets a pin with `flat: true` over the frames it is planted. A pin holds the hand or foot where it is at `from`, orientation included, so key the pose you want there first. `preview.floor` shows whether it works. It should report contacts only where the motion touches the floor, and `airborne` only where the character really leaves the ground. Sinking up to about 3 cm is normal; the catalog walk does too.

To change an animation you only know by its id (an Action Sequence AnimationTrack, a script), open it with studiorpc_animation_read `assetId`. Edit the returned assetPath, publish, and put the new id where the old one was used.

## Done

The clip is saved, the contact sheet reads as the request at its key frames, and the floor report matches the intended contacts. If the clip is going into an Action Sequence or a script, publish it once with the final revision and use the returned `ovdrassetid://N`. Each publish uploads a new copy, so publish again only after an edit. Report the assetPath, the asset id if any, and any compromise you made.
