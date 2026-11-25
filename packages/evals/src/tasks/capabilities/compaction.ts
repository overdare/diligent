// @summary Capability probe: manual compaction runs and a later turn still recalls seeded facts

import { COMPACTION_MIN_INPUT_TOKENS } from "@diligent/core/compaction-contract";
import type { RuntimeEvalTask } from "../../runtime-task";
import type { EvalProfile } from "../../task";
import { finalAssistantText, RuntimeGrade, unwrapReply } from "../runtime/grading";
import {
  createFixtureRuntimeConfig,
  DEFAULT_RUNTIME_LIMITS,
  type RuntimeFixtureWorld,
  seededToken,
} from "../runtime/helpers";

export interface CompactionCapabilityWorld extends RuntimeFixtureWorld {
  alpha: string;
  beta: string;
}

export const compactionCapabilityTask: RuntimeEvalTask<CompactionCapabilityWorld> = {
  id: "capability-compaction",
  description: "Compact an eligible thread, then recall two seeded facts on the next turn.",
  fixtureVersion: "capability-compaction-v1",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 3, maxToolCalls: 0, maxChangedFiles: 0, timeoutMs: 360_000 },
  toolPolicy: { allowedTools: [], allowedCapabilities: [], allowedCommands: [] },
  async setup(seed, root) {
    const alpha = seededToken(seed, "ALPHA");
    const beta = seededToken(seed, "BETA");
    return {
      root,
      seed,
      alpha,
      beta,
      expected: `ALPHA=${alpha}; BETA=${beta}`,
      protectedPaths: [],
      allowedChanges: [],
    };
  },
  async createRuntimeConfig(world: CompactionCapabilityWorld, profile: EvalProfile) {
    const config = await createFixtureRuntimeConfig(world, profile);
    return { ...config, compaction: { enabled: true, reservePercent: 16, timeoutMs: 180_000 } };
  },
  createSteps: (world) => [
    {
      kind: "turn",
      message: [
        `Remember these exact facts for later turns: ALPHA=${world.alpha}; BETA=${world.beta}.`,
        "The following deterministic filler only makes this thread eligible for compaction and carries no facts:",
        compactionPadding(),
        "Reply only ACK.",
      ].join("\n"),
    },
    { kind: "compact" },
    {
      kind: "turn",
      message:
        "Reply with exactly ALPHA=<value>; BETA=<value> using the facts from earlier in this thread, with no other text.",
    },
  ],
  snapshotWorld: async (world) => ({ alpha: world.alpha, beta: world.beta }),
  evaluate(input) {
    const grade = new RuntimeGrade("capability_compaction");
    const compaction = input.compactions[0];
    if (!compaction?.response.compacted)
      return grade.fail("not_compacted", "The compaction step did not compact the thread.", "behavior");
    if (input.turns.length < 2) return grade.fail("no_follow_up", "No turn ran after compaction.", "behavior");
    const answer = finalAssistantText(input);
    if (!answer.includes(input.world.alpha) || !answer.includes(input.world.beta))
      return grade.fail("lost_facts", "The post-compaction reply did not recall both seeded facts.", "semantic_goal");
    if (unwrapReply(answer) !== input.world.expected)
      return grade.fail("format", `Expected exactly ${input.world.expected}.`, "format_contract");
    return grade.pass();
  },
};

function compactionPadding(): string {
  const unit = "eligible-compaction-padding ";
  return unit.repeat(Math.ceil((COMPACTION_MIN_INPUT_TOKENS * 4) / unit.length) + 1);
}
