---
name: character-animation
description: Author or change an ODA character animation clip (emote, attack, dance, reaction) with studiorpc_animation_write, and give it an ovdrassetid with studiorpc_animation_publish when it will be used in a game. Not for choosing an existing catalog animation.
---

# Character Animation

Make a clip that a person watching it would recognise as the requested motion, with weight and timing that feel alive. The tool descriptions define the JSON, pins and preview; this skill covers what they cannot: how the ODA rig moves and what ODA's own animations look like in numbers.

Work poses out with studiorpc_animation_write with `dryRun: true` before you write. It evaluates the clip in seconds without saving or rendering. For each frame it returns where every joint is, the lowest skin point of the hands, feet and seat, and any limb sunk into the body with the move that gets it out. A pin over one frame with a `position` is an IK solve: the report's `keys` are the arm or leg rotations that put the hand or foot there, ready to copy into your keys. Add a `pole` to say where the elbow or knee should point; without one, a solve can pick an elbow raised to head height. `directions` in the check says where each palm and sole faces. Write once the check is clean, then judge the contact sheet.

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

A channel means what the table says only near the reference pose. Once UpperArm Y is past about 100 (the arm above shoulder height), Z+ swings the raised arm back and Z− swings it forward. The head is large, so a raised arm meets it early. Straight up (Y 155, Z 0) already puts the forearm 5–6 cm into the head. Overhead poses stay clear at Y 140 or less with Z 0 or less, or at Y 155 with Z about −30 (slightly forward). Z+ with a bent elbow brings the hand into the head. Leaning the torso does not change this, because the head leans with it.

A boxing guard clears the head with UpperArm Y 0–30 and Z 40–45, and LowerArm Z 80–90. That puts the fist 15–25 cm in front of the face. Measured with the torso and head at rest: a head turn or hip twist brings the head toward a fist, so check the guard frames with studiorpc_animation_write with `dryRun: true`. A tighter elbow (115 or more) or UpperArm Z 70 or more puts the fist 8–13 cm inside the head. To place a guard fist by IK, put the pole below and out from the shoulder so the elbow stays down.

Hand X and LowerArm X twist about the forearm while the wrist is straight; once the wrist is bent (Hand Y), Hand X turns the hand about its own length instead. That twist is how you turn the palm. The hand has no finger bones and its shape never changes, so check the palm's direction in the contact sheet. The fist reaches 18–21 cm past the hand bone along the forearm, so a hand on the floor keeps its bone that high above it.

The legs are a thigh of 27.7 cm and a shin of 24.0 cm. The hip joints are 68.9 cm above the floor and the ankles 17.4 cm. The reference leg is almost straight (knee 7°), so a pinned foot cannot reach a hip that rises above standing height or moves more than about 51 cm from the ankle. Lowering the hips bends the knees fast: 5 cm lower needs a knee of about 50, 10 cm about 73, and 20 cm about 105. The sole stays at the angle it has in the reference pose when LowerTorso Z + UpperLeg Z + LowerLeg Z + Foot Z = 0. A positive sum points the toes down and a negative sum lifts them.

The sole is 17.4 cm below the ankle and the toe tip 26 cm ahead of it. Foot Z+ lowers the toes: +15 by 6 cm, +30 by 11 cm, +45 by 14 cm. A pointed foot on the floor therefore needs its ankle raised that much. Foot Z −30 drops the heel 3 cm. Sitting on the floor with level thighs, the seat touches down at a LowerTorso translation x of about −62.

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
- A loop repeats its first key as its last. A one-shot clip ends near its start pose with the hips over the feet, unless the request says otherwise, so the next clip can follow it.
- The hips rise only once something below supports them: feet planted under them, or a hand on the floor.
- Holds keep a little motion (breathing, a small drift) so they don't read as frozen.

A foot on the ground gets a pin with `flat: true` over the frames it is planted. A pin holds the hand or foot where it is at `from`, orientation included, so key the pose you want there first. When the heel leaves the floor before the foot does (a push-off, a step, rising onto the toes), follow the flat pin with a `pivot: "toe"` pin and key Foot Z up over those frames; a pin that starts right after another on the same foot continues from it, so flat, toe, flat stays in place. Lift the heel with the knee already bent: near full extension a 1 cm rise turns the knee about 20° in one frame. A hand or foot that must travel a route (a wave's arc, a punch's line) takes a `path` instead of hand-keyed arm rotations. `preview.floor` shows whether it works. It should report contacts only where the motion touches the floor, and `airborne` only where the character really leaves the ground. Sinking up to about 3 cm is normal; the catalog walk does too.

A body that turns over or lies on the floor (a roll, a fall, sitting down, lying) gets `ground` over those frames instead of hand-keyed hip heights: Studio raises or lowers the hips on every frame so the lowest skin point meets the floor, and `result.ground.contacts` lists which part touches it when. Turn the body with LowerTorso Z, never Root, which swings it around the feet. Measured forward roll: LowerTorso Z 30 at the crouch to 360 about 28 frames later, moving forward about 100 cm (translation y); curled up with Head Z 40, UpperTorso01 and 02 Z 25 each, UpperLeg Z −90 to −110 and LowerLeg Z 110 to 125; `ground` over the whole clip and flat foot pins while standing before and after. That touches down hands, head, upper back, hips, then feet, with nothing floating or sinking. UpperArm Z above about 90 with the head tucked puts the forearms 2–3 cm into the head.

To change an animation you only know by its id (an Action Sequence AnimationTrack, a script), open it with studiorpc_animation_read `assetId`. Edit the returned assetPath, publish, and put the new id where the old one was used.

## Done

The clip is saved, the contact sheet reads as the request at its key frames, and the floor report matches the intended contacts. `preview.clearance` shows no hand, forearm, shin or foot sunk into the body over several frames or deeper than a few cm, and no pin reports an `entryJumpDeg` or `exitJumpDeg` above about 15. If the clip is going into an Action Sequence or a script, publish it once with the final revision and use the returned `ovdrassetid://N`. Each publish uploads a new copy, so publish again only after an edit. Report the assetPath, the asset id if any, and any compromise you made.
