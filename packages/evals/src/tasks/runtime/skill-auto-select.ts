// @summary Runtime eval fixture for intent-based skill selection and one declared reference read

import type { RuntimeEvalExecution, RuntimeEvalTask, RuntimeToolTrace } from "../../runtime-task";
import { isRecord } from "../core/helpers";
import { RuntimeGrade, successfulReadsOf, tracePaths, traceTargets } from "./grading";
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

const OUTPUT_PATH = "HANDOFF.txt";
const SELECTED_SKILL = "release-handoff";
const SELECTED_REFERENCE = ".diligent/skills/release-handoff/references/rendering-rule.txt";

const SKILLS = [
  {
    name: SELECTED_SKILL,
    description: "Prepare a release handoff artifact using the project's prescribed handoff workflow.",
    reference: "references/rendering-rule.txt",
  },
  {
    name: "incident-brief",
    description: "Summarize an operational incident using the project's triage and escalation workflow.",
    reference: "references/triage-rule.txt",
  },
  {
    name: "dependency-review",
    description: "Review dependency upgrade risk using the project's compatibility audit workflow.",
    reference: "references/audit-rule.txt",
  },
] as const;

export interface SkillAutoSelectWorld extends RuntimeFixtureWorld {
  skillNames: string[];
  skillDescriptions: string[];
  selectedSkillName: string;
  selectedReferencePath: string;
  decoyReferencePaths: string[];
  ruleToken: string;
  expectedHash: string;
}

export const skillAutoSelectTask: RuntimeEvalTask<SkillAutoSelectWorld> = {
  id: "skill-auto-select",
  description: "Select one uniquely matching task-local skill and read only its declared reference.",
  fixtureVersion: "skill-auto-select-v2",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 5, maxToolCalls: 4, timeoutMs: 240_000 },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["skill", "read", "apply_patch", "edit"],
    allowedCapabilities: ["skill", "read", "write"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const ruleToken = seededToken(seed, "HANDOFF_RULE");
    const expected = `Release capsule: ${ruleToken}\n`;
    const files: Record<string, string> = {};
    for (const skill of SKILLS) {
      const selected = skill.name === SELECTED_SKILL;
      files[`.diligent/skills/${skill.name}/SKILL.md`] = [
        "---",
        `name: ${skill.name}`,
        `description: ${skill.description}`,
        "---",
        `Read exactly \`${skill.reference}\` and follow its rule. Do not read any other file.`,
        "",
      ].join("\n");
      files[`.diligent/skills/${skill.name}/${skill.reference}`] = selected
        ? `Create ${OUTPUT_PATH} with exactly this content, including the final newline:\n${expected}`
        : `This decoy rule must never be loaded (${seededToken(seed, skill.name)}).\n`;
    }
    await writeFixture(root, files);
    const skillPaths = SKILLS.map((skill) => `.diligent/skills/${skill.name}/SKILL.md`);
    const referencePaths = SKILLS.map((skill) => `.diligent/skills/${skill.name}/${skill.reference}`);
    return {
      root,
      seed,
      skillNames: SKILLS.map((skill) => skill.name),
      skillDescriptions: SKILLS.map((skill) => skill.description),
      selectedSkillName: SELECTED_SKILL,
      selectedReferencePath: SELECTED_REFERENCE,
      decoyReferencePaths: referencePaths.filter((path) => path !== SELECTED_REFERENCE),
      ruleToken,
      expected,
      expectedHash: sha256Text(expected),
      protectedPaths: [...skillPaths, ...referencePaths],
      allowedChanges: [OUTPUT_PATH],
    };
  },
  createRuntimeConfig: createFixtureRuntimeConfig,
  createSteps: () => [
    {
      kind: "turn",
      message:
        "Prepare a release handoff artifact by following the project's specialized handoff workflow. Save the finished artifact as HANDOFF.txt.",
    },
  ],
  verify: (world, signal) => verifyExactFiles(world, { [OUTPUT_PATH]: world.expected }, signal),
  snapshotWorld: async (world) => ({ result: await exactFile(world.root, OUTPUT_PATH) }),
  evaluate(input) {
    const grade = new RuntimeGrade("skill_auto_select");
    const world = input.world;
    const skillCalls = input.toolCalls.filter((call) => call.capability === "skill");
    const selections = skillCalls.filter((call) => isRecord(call.input) && call.input.name === world.selectedSkillName);
    if (skillCalls.some((call) => call.outcome === "success" && !selections.includes(call)))
      return grade.fail("unexpected_skill_call", "A non-matching decoy skill was loaded.", "behavior");
    const decoyDirectories = world.skillNames
      .filter((name) => name !== world.selectedSkillName)
      .map((name) => `.diligent/skills/${name}/`);
    const decoyReads = input.toolCalls.filter(
      (call) =>
        call.capability === "read" &&
        call.outcome === "success" &&
        tracePaths(call, input.threadCwd).some((path) =>
          decoyDirectories.some((directory) => path.startsWith(directory)),
        ),
    );
    if (decoyReads.length > 0)
      return grade.fail("wrong_reference_reads", "A decoy skill file or reference was read.", "runtime_policy");
    const firstSelection = selections[0];
    const firstReferenceRead = successfulReadsOf(input, world.selectedReferencePath)[0];
    if (!firstSelection || (firstReferenceRead && firstReferenceRead.sequence < firstSelection.sequence))
      return grade.fail(
        "skill_not_loaded",
        "The matching skill was not selected before its declared reference was used.",
        "behavior",
      );
    if (input.verifier?.timedOut)
      return grade.fail("verifier_timeout", "Independent exact-file verification timed out.", "harness_terminal");
    if (input.verifier?.exitCode !== 0)
      return grade.fail("verifier", "Independent exact-file verification did not pass.", "semantic_goal");
    const result = input.workspace.final.entries.find((entry) => entry.path === OUTPUT_PATH);
    if (result?.sha256 !== world.expectedHash)
      return grade.fail(
        "wrong_result",
        `${OUTPUT_PATH} did not contain the exact opaque-rule result.`,
        "semantic_goal",
      );
    noteSkillPath(grade, input, firstSelection);
    return grade.pass();
  },
};

function noteSkillPath(
  grade: RuntimeGrade,
  input: RuntimeEvalExecution<SkillAutoSelectWorld>,
  firstSelection: RuntimeToolTrace,
): void {
  const world = input.world;
  if (input.toolCalls.some((call) => call.sequence < firstSelection.sequence))
    grade.note("skill_not_first", "Other tool calls preceded selecting the matching skill.", { impact: "info" });
  const skillCalls = input.toolCalls.filter((call) => call.capability === "skill");
  if (!skillCalls.some((call) => call.outcome === "success"))
    grade.note("skill_load_failed", "The matching skill was selected but the skill tool did not load it.");
  if (skillCalls.length > 1) grade.note("repeated_skill_call", "The skill tool was called more than once.");
  const referenceReads = successfulReadsOf(input, world.selectedReferencePath);
  if (referenceReads.length > 1) grade.note("repeated_reference_read", "The declared reference was read repeatedly.");
  const otherReads = input.toolCalls.filter(
    (call) => call.capability === "read" && !traceTargets(call, world.selectedReferencePath, input.threadCwd),
  );
  if (otherReads.some((call) => call.outcome !== "success"))
    grade.note("failed_read_probe", "A read probe failed or was rejected.", { impact: "info" });
  if (otherReads.some((call) => call.outcome === "success"))
    grade.note("undeclared_read", "Files other than the declared reference were read.", { impact: "info" });
  const writes = input.toolCalls.filter((call) => call.capability === "write");
  if (writes.some((call) => call.outcome !== "success"))
    grade.note("write_recovery", "A write attempt failed before the artifact was produced.");
  if (writes.filter((call) => call.outcome === "success").length > 1)
    grade.note("repeated_write", "The artifact was written more than once.");
}
