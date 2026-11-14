// @summary Runtime eval fixture proving abstention from attractive but irrelevant task-local skills

import type { RuntimeEvalTask } from "../../runtime-task";
import { RuntimeGrade, tracePaths } from "./grading";
import {
  createFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  exactFile,
  type RuntimeFixtureWorld,
  seededToken,
  sha256Text,
  verifyExactFiles,
  writeFixture,
} from "./helpers";

const OUTPUT_PATH = "STATUS.txt";
const SKILLS = [
  {
    name: "release-handoff",
    description: "Prepare a multi-section release handoff artifact from a release inventory.",
  },
  {
    name: "incident-brief",
    description: "Turn incident evidence into a triage brief with escalation guidance.",
  },
  {
    name: "dependency-review",
    description: "Analyze a dependency upgrade and produce a compatibility risk review.",
  },
] as const;

export interface SkillAbstainWorld extends RuntimeFixtureWorld {
  skillNames: string[];
  skillDescriptions: string[];
  skillPaths: string[];
  referencePaths: string[];
  requestedContent: string;
  expectedHash: string;
}

export const skillAbstainTask: RuntimeEvalTask<SkillAbstainWorld> = {
  id: "skill-abstain",
  description: "Complete a fully specified direct edit without loading irrelevant advertised skills.",
  fixtureVersion: "skill-abstain-v1",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 2, maxToolCalls: 2, timeoutMs: 240_000 },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["skill", "apply_patch", "edit"],
    allowedCapabilities: ["skill", "write"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const requestedContent = `status=${seededToken(seed, "READY")}\n`;
    const files: Record<string, string> = {};
    for (const skill of SKILLS) {
      files[`.diligent/skills/${skill.name}/SKILL.md`] = [
        "---",
        `name: ${skill.name}`,
        `description: ${skill.description}`,
        "---",
        "Read `references/template.txt` before performing this specialized workflow.",
        "",
      ].join("\n");
      files[`.diligent/skills/${skill.name}/references/template.txt`] =
        `Irrelevant template ${seededToken(seed, skill.name)}\n`;
    }
    await writeFixture(root, files);
    const skillPaths = SKILLS.map((skill) => `.diligent/skills/${skill.name}/SKILL.md`);
    const referencePaths = SKILLS.map((skill) => `.diligent/skills/${skill.name}/references/template.txt`);
    return {
      root,
      seed,
      skillNames: SKILLS.map((skill) => skill.name),
      skillDescriptions: SKILLS.map((skill) => skill.description),
      skillPaths,
      referencePaths,
      requestedContent,
      expected: requestedContent,
      expectedHash: sha256Text(requestedContent),
      protectedPaths: [...skillPaths, ...referencePaths],
      allowedChanges: [OUTPUT_PATH],
    };
  },
  createRuntimeConfig: createFixtureRuntimeConfig,
  createSteps: (world) => [
    {
      kind: "turn",
      message: `Create STATUS.txt with exactly this content, including the final newline:\n${world.requestedContent}`,
    },
  ],
  verify: (world, signal) => verifyExactFiles(world, { [OUTPUT_PATH]: world.expected }, signal),
  snapshotWorld: async (world) => ({ result: await exactFile(world.root, OUTPUT_PATH) }),
  evaluate(input) {
    const grade = new RuntimeGrade("skill_abstain");
    if (input.toolCalls.some((call) => call.capability === "skill" && call.outcome === "success"))
      return grade.fail("skill_called", "An irrelevant skill was loaded.", "behavior");
    if (
      input.toolCalls.some(
        (call) =>
          call.capability === "read" &&
          call.outcome === "success" &&
          tracePaths(call, input.threadCwd).some((path) => path.startsWith(".diligent/skills/")),
      )
    )
      return grade.fail("skill_file_read", "A skill or reference file was read directly.", "runtime_policy");
    if (input.verifier?.timedOut)
      return grade.fail("verifier_timeout", "Independent exact-file verification timed out.", "harness_terminal");
    if (input.verifier?.exitCode !== 0)
      return grade.fail("verifier", "Independent exact-file verification did not pass.", "semantic_goal");
    const result = input.workspace.final.entries.find((entry) => entry.path === OUTPUT_PATH);
    if (result?.sha256 !== input.world.expectedHash)
      return grade.fail("wrong_result", `${OUTPUT_PATH} did not contain the exact requested content.`, "semantic_goal");
    if (input.toolCalls.some((call) => call.capability === "skill"))
      grade.note("rejected_skill_call", "A skill call was attempted but did not load a skill.");
    if (input.toolCalls.some((call) => call.capability === "read"))
      grade.note("extra_read", "Read calls were made for a fully specified direct edit.", { impact: "info" });
    const writes = input.toolCalls.filter((call) => call.capability === "write");
    if (writes.some((call) => call.outcome !== "success"))
      grade.note("write_recovery", "A write attempt failed before the requested file was produced.");
    if (writes.filter((call) => call.outcome === "success").length > 1)
      grade.note("repeated_write", "The requested file was written more than once.");
    return grade.pass();
  },
};
