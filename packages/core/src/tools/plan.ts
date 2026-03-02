// @summary Plan tool — create and update a visible task checklist during long-horizon execution
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../tool/types";

const PlanStep = z.object({
  text: z.string().describe("Step description"),
  done: z.boolean().default(false).describe("Whether this step is complete"),
});

const PlanParams = z.object({
  steps: z.array(PlanStep).min(1).describe("Ordered list of steps in the plan"),
  title: z.string().optional().describe("Optional plan title (default: 'Plan')"),
});

export type PlanStep = z.infer<typeof PlanStep>;

export function createPlanTool(): Tool<typeof PlanParams> {
  return {
    name: "plan",
    description:
      "Create or update a visible task checklist. Call this at the start of complex multi-step tasks " +
      "to show the user your plan, then call it again after completing each step to update the checklist. " +
      "Do not use for simple tasks that require fewer than 3 steps.",
    parameters: PlanParams,
    execute: async (args, _ctx: ToolContext): Promise<ToolResult> => {
      if (args.steps.length === 0) {
        throw new Error("Plan must have at least one step");
      }
      return {
        output: JSON.stringify({
          title: args.title ?? "Plan",
          steps: args.steps.map((s) => ({ text: s.text, done: s.done ?? false })),
        }),
      };
    },
  };
}
