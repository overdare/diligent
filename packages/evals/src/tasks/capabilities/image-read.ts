// @summary Capability probe: read_image delivers a fixed quadrant image the model must decode exactly

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeEvalTask } from "../../runtime-task";
import { EVAL_QUADRANTS, type EvalQuadrantLayout, quadrantColorPng, seededQuadrantLayout } from "../image-fixture";
import { finalAssistantText, RuntimeGrade, successfulReadsOf, unwrapReply } from "../runtime/grading";
import { createFixtureRuntimeConfig, DEFAULT_RUNTIME_LIMITS, type RuntimeFixtureWorld } from "../runtime/helpers";

const IMAGE_PATH = "quadrants.png";

export interface ImageReadCapabilityWorld extends RuntimeFixtureWorld {
  layout: EvalQuadrantLayout;
}

export const imageReadCapabilityTask: RuntimeEvalTask<ImageReadCapabilityWorld> = {
  id: "capability-image-read",
  description: "Read one image through read_image and report the color of each quadrant.",
  fixtureVersion: "capability-image-read-v2",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 3, maxToolCalls: 2, maxChangedFiles: 0, timeoutMs: 180_000 },
  statePolicy: { allowedMutations: ["infrastructure", "sessions", "image_sidecars"] },
  toolPolicy: { allowedTools: ["read_image"], allowedCapabilities: ["read"], allowedCommands: [] },
  async setup(seed, root) {
    const layout = seededQuadrantLayout(seed);
    await writeFile(join(root, IMAGE_PATH), quadrantColorPng(layout));
    return { root, seed, layout, expected: renderLayout(layout), protectedPaths: [IMAGE_PATH], allowedChanges: [] };
  },
  createRuntimeConfig: createFixtureRuntimeConfig,
  createSteps: (world) => [
    {
      kind: "turn",
      message: [
        `Call read_image once on ${world.root}/${IMAGE_PATH}.`,
        "The image is split into four equal quadrants; each is filled with exactly one of RED, GREEN, BLUE, or YELLOW.",
        "Reply with exactly TL=<color>; TR=<color>; BL=<color>; BR=<color> for the top-left, top-right, bottom-left,",
        "and bottom-right quadrants, with no other text.",
      ].join(" "),
    },
  ],
  snapshotWorld: async (world) => ({ layout: world.layout }),
  evaluate(input) {
    const grade = new RuntimeGrade("capability_image_read");
    if (successfulReadsOf(input, IMAGE_PATH).length === 0)
      return grade.fail("not_read", "read_image never returned the fixture image.", "behavior");
    const answer = finalAssistantText(input);
    const reported = parseLayout(answer);
    const wrong = EVAL_QUADRANTS.filter((quadrant) => reported[quadrant] !== input.world.layout[quadrant]);
    if (wrong.length > 0)
      return grade.fail("answer", `Misidentified quadrant color(s): ${wrong.join(", ")}.`, "semantic_goal");
    if (unwrapReply(answer) !== input.world.expected)
      return grade.fail("format", `Expected exactly ${input.world.expected}.`, "format_contract");
    return grade.pass();
  },
};

function renderLayout(layout: EvalQuadrantLayout): string {
  return EVAL_QUADRANTS.map((quadrant) => `${quadrant}=${layout[quadrant]}`).join("; ");
}

function parseLayout(answer: string): Partial<EvalQuadrantLayout> {
  const reported: Partial<EvalQuadrantLayout> = {};
  for (const match of answer.matchAll(/\b(TL|TR|BL|BR)\s*=\s*(RED|GREEN|BLUE|YELLOW)\b/gi)) {
    reported[match[1]!.toUpperCase() as keyof EvalQuadrantLayout] = match[2]!.toUpperCase() as EvalQuadrantLayout["TL"];
  }
  return reported;
}
