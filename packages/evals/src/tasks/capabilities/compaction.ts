// @summary Capability probe: manual compaction runs and a later turn still recalls facts from compacted tool output

import { COMPACTION_MIN_INPUT_TOKENS } from "@diligent/core/compaction-contract";
import type { BundledToolProvider } from "@diligent/runtime";
import { z } from "zod";
import type { RuntimeEvalTask } from "../../runtime-task";
import type { EvalProfile } from "../../task";
import { finalAssistantText, RuntimeGrade, unwrapReply } from "../runtime/grading";
import {
  createFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  type RuntimeFixtureWorld,
  seededToken,
} from "../runtime/helpers";

export const NOTES_TOOL = "load_project_notes";
const PADDING_UNIT = "eligible-compaction-padding ";
/** Filler that makes the thread eligible for manual compaction by itself. */
const PADDING = PADDING_UNIT.repeat(Math.ceil((COMPACTION_MIN_INPUT_TOKENS * 4) / PADDING_UNIT.length) + 1);

export interface CompactionCapabilityWorld extends RuntimeFixtureWorld {
  alpha: string;
  beta: string;
  /** Successful note loads; the tool refuses every later call so recall must come from compacted context. */
  loads: number;
}

/**
 * The facts arrive in a large tool result rather than the user message. Provider-native compaction keeps user
 * messages verbatim and drops tool output, so only this placement makes the compaction itself carry the facts.
 */
export const compactionCapabilityTask: RuntimeEvalTask<CompactionCapabilityWorld> = {
  id: "capability-compaction",
  description: "Load facts in a large tool result, compact the thread, then recall the facts on the next turn.",
  fixtureVersion: "capability-compaction-v2",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 4, maxToolCalls: 1, maxChangedFiles: 0, timeoutMs: 420_000 },
  toolPolicy: { allowedTools: [NOTES_TOOL], allowedCapabilities: ["execute"], allowedCommands: [] },
  async setup(seed, root) {
    const alpha = seededToken(seed, "ALPHA");
    const beta = seededToken(seed, "BETA");
    return {
      root,
      seed,
      alpha,
      beta,
      loads: 0,
      expected: `ALPHA=${alpha}; BETA=${beta}`,
      protectedPaths: [],
      allowedChanges: [],
    };
  },
  async createRuntimeConfig(world: CompactionCapabilityWorld, profile: EvalProfile) {
    const config = await createFixtureRuntimeConfig(world, profile);
    return { ...config, compaction: { enabled: true, reservePercent: 16, timeoutMs: 180_000 } };
  },
  createBundledToolProviders: (world) => [notesProvider(world)],
  createSteps: () => [
    {
      kind: "turn",
      message: [
        `Call ${NOTES_TOOL} exactly once. It returns this project's ALPHA and BETA values, which you must remember for`,
        "later turns. After the call, reply only ACK.",
      ].join(" "),
    },
    { kind: "compact" },
    {
      kind: "turn",
      message:
        "Reply with exactly ALPHA=<value>; BETA=<value> using the values the project notes returned earlier in this thread, with no other text.",
    },
  ],
  snapshotWorld: async (world) => ({ alpha: world.alpha, beta: world.beta, loads: world.loads }),
  evaluate(input) {
    const grade = new RuntimeGrade("capability_compaction");
    const loads = input.toolCalls.filter((call) => call.name === NOTES_TOOL && call.outcome === "success");
    if (!loads.some((call) => call.turnIndex === 0))
      return grade.fail("notes_not_loaded", "The project notes were never loaded before compaction.", "behavior");
    const compaction = input.compactions[0];
    if (!compaction?.response.compacted)
      return grade.fail("not_compacted", "The compaction step did not compact the thread.", "behavior");
    if (input.turns.length < 2) return grade.fail("no_follow_up", "No turn ran after compaction.", "behavior");
    const answer = finalAssistantText(input);
    if (!answer.includes(input.world.alpha) || !answer.includes(input.world.beta))
      return grade.fail("lost_facts", "The post-compaction reply did not recall both seeded facts.", "semantic_goal");
    if (unwrapReply(answer) !== input.world.expected)
      return grade.fail("format", `Expected exactly ${input.world.expected}.`, "format_contract");
    const acknowledgement = finalAssistantText(input, 0);
    if (acknowledgement.includes(input.world.alpha) || acknowledgement.includes(input.world.beta))
      grade.note("facts_echoed", "The pre-compaction reply repeated a fact, so recall did not depend on compaction.", {
        dimension: "behavior",
      });
    return grade.pass();
  },
};

function notesProvider(world: CompactionCapabilityWorld): BundledToolProvider {
  const facts = `ALPHA=${world.alpha}\nBETA=${world.beta}`;
  const output = `PROJECT NOTES\n${facts}\n\n${PADDING}\n\nEND OF PROJECT NOTES (repeated values)\n${facts}\n`;
  return {
    id: "eval-capability-compaction-notes",
    createTools: () => [
      {
        name: NOTES_TOOL,
        description: "Load this project's notes, including its ALPHA and BETA values. The notes can be loaded once.",
        parameters: z.object({}).strict(),
        execute: async () => {
          if (world.loads > 0) throw new Error("The project notes were already loaded once in this thread.");
          world.loads += 1;
          return { output, maxOutputBytes: Buffer.byteLength(output) + 1_024 };
        },
      },
    ],
  };
}
