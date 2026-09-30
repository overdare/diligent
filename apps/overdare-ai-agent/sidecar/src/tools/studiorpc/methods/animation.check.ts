// @summary Declares the Studio RPC method that evaluates an animation clip without saving or rendering it.
import { z } from "zod";
import {
  ANIMATION_TIMEOUT_MS,
  animationSchema,
  formatCheckResult,
  groundSchema,
  pinsSchema,
  withErrorData,
} from "./animation-shared";

export const method = "animation.check";

export const timeoutMs = ANIMATION_TIMEOUT_MS;

export const description =
  "Evaluate a clip without saving it or rendering an image: seconds instead of a full write. Send the same " +
  "animation JSON and pins as studiorpc_animation_write. Use it while you work out a pose, then write once it checks out.\n" +
  "Per frame (frames: up to 24; default: up to 12 of the keyed frames and pin edges; ask for the few frames you are " +
  "working on): joints = hips (LowerTorso), head, elbows (LowerArm), hands, knees (LowerLeg) and feet; " +
  "lowestPointCm = the lowest skin point of each hand, foot, LowerTorso and thigh (where the sole, toe or heel, the " +
  "fist and the seat really are, not the bone); penetrations = up to 3 deepest places where a hand, forearm, shin " +
  "or foot sinks into the head, torso or a thigh, with depthCm, deepestPointCm and pushOutCm (the shortest move " +
  "that gets that point out); directions = unit vectors of each hand (fingers: wrist toward fist; palm: the side " +
  "that faces the thigh when standing) and foot (toes: heel toward toes; sole: out of the sole, [0, 0, -1] when " +
  "flat). Positions are component space in cm: x = the character's left, y = forward, z = up, " +
  "floor at z = 0. For the whole clip: floor and clearance, as in the write preview.\n" +
  "pins work as in studiorpc_animation_write. A pin of up to 5 frames also reports keys: the solved rotations of " +
  "the limb's three bones. A pin over one frame, frames: [f, f], with a position is an IK solve: it returns the UpperArm/LowerArm/Hand " +
  "(or UpperLeg/LowerLeg/Foot) rotations that put the hand or foot there, bending the elbow or knee only the way it hinges, " +
  "which you can copy into your own keys; add a pole to choose where the elbow or knee goes. A pin with a path " +
  "of up to 5 frames solves several targets at once. reachMarginCm says how much further the limb could stretch; negative " +
  "means the target is that far out of reach (outOfReachFrames counts those frames).\n" +
  "ground works as in studiorpc_animation_write; result.ground lists which body part touches the floor on which " +
  "frames, the contact order of a roll or fall.\n" +
  "Nothing is created or changed. Errors carry data.kind (INVALID_ANIMATION, INVALID_PARAMS) and data.errors[].";

export const params = z
  .object({
    animation: animationSchema.describe("The whole clip in the studiorpc_animation_write format. Not saved."),
    pins: pinsSchema
      .optional()
      .describe("As in studiorpc_animation_write; pins of up to 5 frames report their solved keys."),
    ground: groundSchema.optional().describe("As in studiorpc_animation_write."),
    frames: z
      .array(z.number().int().min(0))
      .min(1)
      .max(24)
      .optional()
      .describe("Frames to report poses for. Omit for up to 12 of the keyed frames and pin edges."),
  })
  .strict();

export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  if (Array.isArray(out.pins) && out.pins.length === 0) delete out.pins;
  if (Array.isArray(out.frames) && out.frames.length === 0) delete out.frames;
  if (Array.isArray(out.ground) && out.ground.length === 0) delete out.ground;
  return out;
}

export async function recover(error: unknown): Promise<unknown> {
  return withErrorData(error);
}

export function postProcess(result: unknown): unknown {
  return formatCheckResult(result);
}
