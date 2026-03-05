// @summary Plan tool — create and update a visible task checklist during long-horizon execution
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../tool/types";

const PlanStep = z.object({
  text: z.string().describe("Step description"),
  done: z.boolean().default(false).describe("Whether this step is complete"),
});

const PlanParams = z.object({
  steps: z.array(PlanStep).min(1).optional().describe("Ordered list of steps in the plan"),
  title: z.string().optional().describe("Optional plan title (default: 'Plan')"),
  close: z
    .boolean()
    .optional()
    .describe("If true, dismiss the plan panel entirely. Use when the task is done or cancelled."),
});

export type PlanStep = z.infer<typeof PlanStep>;

export function createPlanTool(): Tool<typeof PlanParams> {
  return {
    name: "plan",
    supportParallel: true,
    description:
      "Create or update a visible task checklist. " +
      "Call this at the start of complex multi-step tasks to show the user your plan. " +
      "You MUST call this immediately after completing each step to mark it done=true before moving on to the next step. " +
      "Never skip updating the plan after a step is done — always mark the finished step before starting the next one. " +
      "Call with close=true (no steps needed) to dismiss the plan when the task is done or cancelled. " +
      "Do not use for simple tasks that require fewer than 3 steps.",
    parameters: PlanParams,
    execute: async (args, _ctx: ToolContext): Promise<ToolResult> => {
      if (args.close) {
        return { output: JSON.stringify({ closed: true }) };
      }
      if (!args.steps || args.steps.length === 0) {
        throw new Error("Plan must have at least one step, or set close=true to dismiss");
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
