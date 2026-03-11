// @summary Plan tool — create and update a visible task checklist during long-horizon execution
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../tool/types";

const PlanStep = z.object({
  text: z.string().describe("Step description"),
  status: z
    .enum(["pending", "in_progress", "done", "cancelled"])
    .default("pending")
    .describe(
      "Step status: 'pending' (not started), 'in_progress' (currently active), 'done' (completed), or 'cancelled' (no longer needed)",
    ),
});

const PlanParams = z.object({
  steps: z.array(PlanStep).min(1).describe("Ordered list of steps in the plan"),
  title: z.string().optional().describe("Optional plan title (default: 'Plan')"),
});

export type PlanStep = z.infer<typeof PlanStep>;

export function createPlanTool(): Tool<typeof PlanParams> {
  return {
    name: "plan",
    supportParallel: true,
    description:
      "Create or update a visible task checklist that the user can see. " +
      // When to use
      "Use proactively for: complex multistep tasks (3+ steps), non-trivial tasks requiring careful planning, " +
      "when the user provides multiple tasks, or after receiving new instructions that involve multiple actions. " +
      "Do NOT use for single trivial tasks, purely conversational requests, or tasks completable in under 3 steps. " +
      // How to use
      "Call this at the start of complex tasks to show the user your plan. " +
      "After receiving new instructions, immediately capture requirements as plan steps. " +
      "Each step should represent a unit of work you can complete in one go. " +
      "Only ONE step should be in_progress at a time. Mark each step done immediately after completing it, before starting the next. " +
      "Add any new follow-up steps discovered during execution. Cancel steps that become irrelevant instead of deleting them. " +
      "IMPORTANT: Before summarizing results to the user, call this tool to mark the last step done.",
    parameters: PlanParams,
    execute: async (args, _ctx: ToolContext): Promise<ToolResult> => {
      if (!Array.isArray(args.steps) || args.steps.length === 0) {
        throw new Error("Plan must include at least one step");
      }

      const steps = args.steps.map((s) => ({ text: s.text, status: s.status ?? "pending" }));
      const pending = steps.filter((s) => s.status === "pending").length;
      const inProgress = steps.filter((s) => s.status === "in_progress").length;
      const done = steps.filter((s) => s.status === "done").length;
      const cancelled = steps.filter((s) => s.status === "cancelled").length;
      const remaining = pending + inProgress;

      let hint: string;
      if (remaining === 0 && done + cancelled === steps.length) {
        hint = "All steps resolved. Summarize results to the user.";
      } else if (remaining > 0) {
        hint = `${done}/${steps.length} done, ${inProgress} in progress, ${pending} pending${cancelled > 0 ? `, ${cancelled} cancelled` : ""}. Continue working.`;
      } else {
        hint = "Update the plan as you progress.";
      }

      return {
        output: JSON.stringify({
          title: args.title ?? "Plan",
          steps,
          hint,
        }),
      };
    },
  };
}
