// @summary Runtime eval for paired image reading with bounded, redacted evidence

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeEvalTask } from "../../runtime-task";
import { type EvalImageColor, seededImagePair, solidColorPng } from "../image-fixture";
import { finalAssistantText, RuntimeGrade, successfulReadsOf, unwrapReply } from "./grading";
import { createFixtureRuntimeConfig, DEFAULT_RUNTIME_LIMITS, type RuntimeFixtureWorld } from "./helpers";

export interface ReadImagePairWorld extends RuntimeFixtureWorld {
  colors: { a: EvalImageColor; b: EvalImageColor };
}

export const readImagePairTask: RuntimeEvalTask<ReadImagePairWorld> = {
  id: "read-image-pair",
  description: "Read two seed-swapped images and report each dominant color exactly.",
  fixtureVersion: "read-image-pair-v1",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 6, maxToolCalls: 4, timeoutMs: 180_000 },
  statePolicy: {
    allowedMutations: ["infrastructure", "sessions", "image_sidecars"],
    requiredMutations: ["image_sidecars"],
  },
  toolPolicy: {
    allowedTools: ["read_image"],
    allowedCapabilities: ["read"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const colors = seededImagePair(seed);
    await writeFile(join(root, "a.png"), solidColorPng(colors.a));
    await writeFile(join(root, "b.png"), solidColorPng(colors.b));
    return {
      root,
      seed,
      colors,
      expected: `A=${colors.a}; B=${colors.b}`,
      protectedPaths: ["a.png", "b.png"],
      allowedChanges: [],
    };
  },
  createRuntimeConfig: createFixtureRuntimeConfig,
  createSteps: (world) => [
    {
      kind: "turn",
      message: `Call read_image exactly once on ${world.root}/a.png and exactly once on ${world.root}/b.png. Identify each image's dominant color. Reply with exactly A=RED; B=BLUE or A=BLUE; B=RED, matching the files, with no other text.`,
    },
  ],
  snapshotWorld: async (world) => ({ colors: world.colors }),
  evaluate(input) {
    const grade = new RuntimeGrade("read_image_pair");
    if (JSON.stringify(input).includes("iVBOR"))
      return grade.fail("base64", "Raw image base64 leaked into eval evidence.", "runtime_policy");
    const readsA = successfulReadsOf(input, "a.png");
    const readsB = successfulReadsOf(input, "b.png");
    if (readsA.length === 0 || readsB.length === 0)
      return grade.fail("paths", "Both seeded image paths must be read successfully.", "behavior");
    const answer = finalAssistantText(input);
    const semantic = /A=(RED|BLUE);\s*B=(RED|BLUE)/i.exec(answer);
    if (semantic?.[1]?.toUpperCase() !== input.world.colors.a || semantic?.[2]?.toUpperCase() !== input.world.colors.b)
      return grade.fail("answer", "The response classified one or both images incorrectly.", "semantic_goal");
    if (unwrapReply(answer) !== input.world.expected)
      return grade.fail("answer", `Expected exact response ${input.world.expected}.`, "format_contract");
    if (readsA.length > 1 || readsB.length > 1)
      grade.note("repeated_read", "At least one image was read successfully more than once.");
    const failed = input.toolCalls.filter((call) => call.outcome !== "success");
    if (failed.length > 0)
      grade.note("failed_call", `Observed ${failed.length} failed or rejected tool call(s) before completion.`);
    return grade.pass();
  },
};
