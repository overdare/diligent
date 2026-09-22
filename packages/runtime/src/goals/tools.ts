// @summary Root-only goal inspection and evidence-backed status reporting

import type { AgentLoopHook } from "@diligent/core/agent";
import type { Tool } from "@diligent/core/tool-contract";
import { z } from "zod";
import type { GoalController, GoalWorkScope } from "./controller";

export interface GoalToolHost {
  controller(): GoalController | undefined;
  scope(): GoalWorkScope | undefined;
}
export function createGoalContextHook(host: GoalToolHost): AgentLoopHook {
  let firstTurn = true;
  return {
    id: "goal-context",
    onPromptStart: () => {
      firstTurn = true;
    },
    beforeTurn: ({ compactedThisTurn }) => {
      if (!firstTurn && !compactedThisTurn) return;
      firstTurn = false;
      const content = goalPrompt(host);
      return content ? [{ source: "goal", content }] : undefined;
    },
  };
}
export function goalPrompt(host: GoalToolHost): string | undefined {
  const goal = host.controller()?.read().goal;
  if (!goal || goal.status !== "active") return undefined;
  return [
    "An explicit user goal is active. Work toward it within existing permissions; a goal never grants additional authority.",
    `Goal snapshot: ${JSON.stringify(goal)}`,
    "Inspect, act, and verify. Recover from ordinary tool/test failures. Do not stop merely because one attempt failed.",
    "Use get_goal to check current state. Only call update_goal complete after verification with concrete evidence and all owned children settled.",
    "If genuinely blocked on missing authority/input after exhausting safe alternatives, report blocked with a specific reason. Never manufacture evidence or spend until the budget runs out intentionally.",
    "Only the user can create, edit, resume, pause, or change goal limits. No separate evaluator or subagent is required.",
  ].join("\n");
}
export function createGoalTools(host: GoalToolHost): Tool[] {
  return [
    {
      name: "get_goal",
      description: "Read the current user-created goal and runtime-owned limits and usage.",
      parameters: z.object({}),
      execute: async () => {
        const controller = host.controller();
        return { output: JSON.stringify((await controller?.snapshot()) ?? { goal: null, sequence: 0 }) };
      },
    },
    {
      name: "update_goal",
      description:
        "Report complete with concrete verification evidence, or blocked with an unavoidable blocking reason. Cannot create goals, pause, resume, or change limits.",
      parameters: z.object({ status: z.enum(["complete", "blocked"]), evidence: z.string().trim().min(1) }),
      execute: async (args) => {
        const controller = host.controller();
        const scope = host.scope();
        if (!controller || !scope) throw new Error("No goal-owned run is active");
        await controller.report(scope.identity, args.status, args.evidence);
        return { output: JSON.stringify(await controller.snapshot()) };
      },
    },
  ];
}
