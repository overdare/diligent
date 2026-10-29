// @summary Strict runtime eval for sidecar-backed image recall across server restart

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RuntimeEvalTask } from "../../runtime-task";
import { type EvalImageColor, seededImagePair, solidColorPng } from "../image-fixture";
import { finalAssistantText, isExactReply, RuntimeGrade, successfulReadsOf } from "./grading";
import { createFixtureRuntimeConfig, DEFAULT_RUNTIME_LIMITS, type RuntimeFixtureWorld } from "./helpers";

const FIXTURE_PATH = "remembered-color.png";
const TOOL_NAME = "read_image";

export interface ImageResumeRecallWorld extends RuntimeFixtureWorld {
  color: EvalImageColor;
  fixturePath: string;
  fixtureSha256: string;
  sidecarRefSha256: string;
  fixtureSize: number;
}

export const imageResumeRecallTask: RuntimeEvalTask<ImageResumeRecallWorld> = {
  id: "image-resume-recall",
  description: "Read one image, restart, and recall its dominant color from sidecar-backed session evidence.",
  fixtureVersion: "image-resume-recall-v2",
  limits: {
    ...DEFAULT_RUNTIME_LIMITS,
    maxTurns: 3,
    maxToolCalls: 1,
    maxChangedFiles: 0,
    maxChangedBytes: 0,
    timeoutMs: 180_000,
  },
  statePolicy: {
    allowedMutations: ["infrastructure", "sessions", "image_sidecars"],
    requiredMutations: ["image_sidecars"],
  },
  toolPolicy: {
    allowedTools: [TOOL_NAME],
    allowedCapabilities: ["read"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const color = seededImagePair(seed).a;
    const png = solidColorPng(color);
    await writeFile(join(root, FIXTURE_PATH), png);
    return {
      root,
      seed,
      color,
      fixturePath: FIXTURE_PATH,
      fixtureSha256: createHash("sha256").update(png).digest("hex"),
      sidecarRefSha256: createHash("sha256").update(png.toString("base64")).digest("hex"),
      fixtureSize: png.byteLength,
      expected: `COLOR=${color}`,
      protectedPaths: [FIXTURE_PATH],
      allowedChanges: [],
    };
  },
  createRuntimeConfig: createFixtureRuntimeConfig,
  createSteps: (world) => [
    {
      kind: "turn",
      message: `Inspect the named image at ${world.root}/${world.fixturePath}, remember its dominant color for a later turn, and reply exactly ACK. Do not mention how you inspected it or reveal the color.`,
    },
    { kind: "restart_and_resume" },
    {
      kind: "turn",
      message:
        "Based only on your earlier inspection, reply with exactly COLOR=<dominant color>, replacing <dominant color> with the remembered value. Do not inspect the image again or include other text.",
    },
  ],
  snapshotWorld: async (world) => ({ color: world.color }),
  evaluate(input) {
    const grade = new RuntimeGrade("image_resume");
    const { world } = input;
    if (input.turns.length !== 2)
      return grade.fail("turns", "Expected the inspection and resumed recall turns.", "harness_terminal");
    const imageReads = successfulReadsOf(input, world.fixturePath).filter((call) => call.name === TOOL_NAME);
    if (!imageReads.some((call) => call.turnIndex === 0))
      return grade.fail("read", "The image was not inspected before the restart.", "behavior");
    if (input.toolCalls.some((call) => call.turnIndex === 1 && call.capability === "read"))
      return grade.fail("reinspected", "The image was inspected again instead of recalled after restart.", "behavior");
    const ack = finalAssistantText(input, 0);
    if (!isExactReply(ack, "ACK"))
      return grade.fail("ack", "The inspection turn must reply exactly ACK.", "format_contract");
    const answer = finalAssistantText(input, 1);
    const recalled = /COLOR=([A-Za-z]+)/.exec(answer)?.[1]?.toUpperCase();
    if (recalled !== world.color)
      return grade.fail("answer", "The resumed answer recalled the wrong color.", "semantic_goal");
    if (!isExactReply(answer.replace(/COLOR=[A-Za-z]+/, `COLOR=${world.color}`), `COLOR=${world.color}`))
      return grade.fail("answer_format", "The resumed answer must be exactly COLOR=<color>.", "format_contract");
    if (JSON.stringify(input).includes("iVBOR"))
      return grade.fail("base64", "Raw PNG base64 leaked into captured evidence.", "runtime_policy");
    if (imageReads.length > 1) grade.note("repeated_read", "The image was read more than once before the restart.");
    return grade.pass();
  },
};
