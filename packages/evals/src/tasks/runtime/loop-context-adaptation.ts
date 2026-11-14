// @summary Runtime eval for adapting to a bundled AgentLoopHook injection after a real tool boundary

import type { AgentContextInjection, AgentLoopHook } from "@diligent/core/agent";
import type { BundledToolProvider } from "@diligent/runtime";
import type { RuntimeEvalTask } from "../../runtime-task";
import { finalAssistantText, RuntimeGrade, successfulReadsOf, successfulWritesTo, traceTargets } from "./grading";
import {
  createIsolatedFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  exactFile,
  type RuntimeFixtureWorld,
  seededToken,
  sha256Text,
  verifyExactFiles,
  writeFixture,
} from "./helpers";

const BRIEF_PATH = "deployment-brief.txt";
const OUTPUT_PATH = "RESULT.txt";
const HOOK_SOURCE = "eval-loop-context-adaptation";
const PRESENTATION = {
  kind: "requirement-update",
  title: "Requirement updated",
  content: "The active deployment lane changed after the project brief was inspected.",
} as const;

export interface LoopContextHookRecord {
  sequence: number;
  phase: "before_turn";
  turnId: string;
  injected: boolean;
}

export interface LoopContextAdaptationWorld extends RuntimeFixtureWorld {
  initialValue: string;
  injectedValue: string;
  initialBrief: string;
  injectedContext: string;
  clientPrompt: string;
  expectedHash: string;
  /** Trace sequence of the first successful brief read that revealed the initial lane; arms the injection. */
  briefReadSequence?: number;
  hookRecords: LoopContextHookRecord[];
  factoryCalls: Array<{ agentKind: string; cwd: string; tools: string[] }>;
}

export const loopContextAdaptationTask: RuntimeEvalTask<LoopContextAdaptationWorld> = {
  id: "loop-context-adaptation",
  description: "Adapt an exact pending workspace result after an internal loop-context requirement update.",
  fixtureVersion: "loop-context-adaptation-v7",
  limits: {
    ...DEFAULT_RUNTIME_LIMITS,
    maxTurns: 4,
    maxToolCalls: 3,
    maxChangedFiles: 1,
    maxChangedBytes: 512,
    timeoutMs: 180_000,
  },
  statePolicy: { allowedMutations: ["infrastructure", "sessions"] },
  toolPolicy: {
    allowedTools: ["read", "apply_patch", "edit"],
    allowedCapabilities: ["read", "write"],
    allowedCommands: [],
  },
  async setup(seed, root) {
    const initialValue = seededToken(seed, "LANE_INITIAL");
    const injectedValue = seededToken(seed, "LANE_UPDATED");
    const initialBrief = `Current deployment lane: ${initialValue}\nRecord only that lane in RESULT.txt with one trailing newline.\n`;
    const injectedContext =
      `The deployment requirement changed. The active lane is now ${injectedValue}. ` +
      `Disregard the earlier ${initialValue} lane and ensure RESULT.txt contains only ${injectedValue} with one trailing newline.`;
    const clientPrompt =
      "No other project file is relevant. Consult deployment-brief.txt; RESULT.txt does not exist yet, so create it to satisfy the current requirement and leave it exact.";
    const expected = `${injectedValue}\n`;
    await writeFixture(root, { [BRIEF_PATH]: initialBrief, ".git/.keep": "fixture boundary\n" });
    return {
      root,
      seed,
      initialValue,
      injectedValue,
      initialBrief,
      injectedContext,
      clientPrompt,
      expected,
      expectedHash: sha256Text(expected),
      hookRecords: [],
      factoryCalls: [],
      protectedPaths: [BRIEF_PATH, ".git/.keep"],
      allowedChanges: [OUTPUT_PATH],
    };
  },
  createRuntimeConfig: createIsolatedFixtureRuntimeConfig,
  observeToolTrace(world, trace) {
    if (
      world.briefReadSequence === undefined &&
      trace.capability === "read" &&
      trace.outcome === "success" &&
      traceTargets(trace, BRIEF_PATH) &&
      JSON.stringify(trace.output ?? "").includes(world.initialValue)
    )
      world.briefReadSequence = trace.sequence;
  },
  createBundledToolProviders(world): readonly BundledToolProvider[] {
    return [
      {
        id: HOOK_SOURCE,
        createTools: () => [],
        createAgentLoopHooks(context): readonly AgentLoopHook[] {
          world.factoryCalls.push({
            agentKind: context.agentKind,
            cwd: context.cwd,
            tools: context.tools.map((tool) => tool.name),
          });
          let injected = false;
          const hook: AgentLoopHook = {
            id: HOOK_SOURCE,
            beforeTurn({ turnId }) {
              const shouldInject = world.briefReadSequence !== undefined && !injected;
              world.hookRecords.push({
                sequence: world.hookRecords.length + 1,
                phase: "before_turn",
                turnId,
                injected: shouldInject,
              });
              if (!shouldInject) return;
              injected = true;
              return [injection(world)];
            },
          };
          return [hook];
        },
      },
    ];
  },
  createSteps: (world) => [{ kind: "turn", mode: "default", message: world.clientPrompt }],
  verify: (world, signal) => verifyExactFiles(world, { [OUTPUT_PATH]: world.expected }, signal),
  snapshotWorld: async (world) => ({
    result: await exactFile(world.root, OUTPUT_PATH),
    briefReadSequence: world.briefReadSequence,
    hookRecords: structuredClone(world.hookRecords),
    factoryCalls: structuredClone(world.factoryCalls),
  }),
  evaluate(input) {
    const grade = new RuntimeGrade("loop_context_adaptation");
    const world = input.world;
    if (successfulReadsOf(input, BRIEF_PATH).length === 0)
      return grade.fail(
        "brief_not_read",
        "The deployment brief was never read, so no requirement update could arrive.",
        "behavior",
      );
    if (!world.hookRecords.some((record) => record.injected))
      return grade.fail("no_injection", "The requirement update was armed but no later turn received it.", "behavior");
    if (input.verifier?.timedOut)
      return grade.fail("verifier_timeout", "Independent verifier timed out.", "harness_terminal");
    const output = input.workspace.final.entries.find((entry) => entry.path === OUTPUT_PATH);
    if (input.verifier?.exitCode !== 0 || output?.sha256 !== world.expectedHash)
      return grade.fail(
        "result",
        output?.sha256 === sha256Text(`${world.initialValue}\n`)
          ? "RESULT.txt kept the stale lane instead of the updated requirement."
          : "RESULT.txt does not contain exactly the updated lane.",
        "semantic_goal",
      );
    const answer = finalAssistantText(input);
    if (answer.includes(world.initialValue) && !answer.includes(world.injectedValue))
      return grade.fail("final_answer", "The final answer reported the stale lane as the result.", "semantic_goal");
    if (successfulWritesTo(input, OUTPUT_PATH).some((call) => JSON.stringify(call.input).includes(world.initialValue)))
      grade.note("stale_write_corrected", "RESULT.txt first received the stale lane and was corrected later.");
    if (!answer.includes(world.injectedValue))
      grade.note("final_answer_omits_result", "The final answer did not name the adapted lane.", {
        dimension: "format_contract",
        impact: "info",
      });
    return grade.pass();
  },
};

function injection(world: LoopContextAdaptationWorld): AgentContextInjection {
  return {
    source: HOOK_SOURCE,
    content: world.injectedContext,
    metadata: { presentation: PRESENTATION },
  };
}
