// @summary Tool that pauses the agent loop to ask the user clarifying questions — D088
import { z } from "zod";
import type { Tool } from "../tool/types";

const OptionSchema = z.object({
  label: z.string().describe("User-facing label (1-5 words)."),
  description: z.string().describe("One short sentence explaining impact/tradeoff if selected."),
});

const QuestionSchema = z.object({
  id: z.string().describe("Stable identifier for mapping answers (snake_case)."),
  header: z.string().max(12).describe("Short header label shown in the UI (12 or fewer chars)."),
  question: z.string().describe("Single-sentence prompt shown to the user."),
  options: z
    .array(OptionSchema)
    .min(1)
    .describe("Provide one or more selectable options."),
  allow_multiple: z
    .boolean()
    .optional()
    .describe("If true, present checkboxes and allow selecting multiple options. If false or omitted, only one listed option should be selected."),
  is_other: z
    .boolean()
    .optional()
    .describe("Set explicitly. true allows a custom free-form answer in addition to listed options; false restricts answers to listed options only."),
  is_secret: z.boolean().optional().describe("If true, mask the input (e.g. passwords)."),
});

const ParamsSchema = z.object({
  questions: z.array(QuestionSchema).min(1).max(3).describe("Questions to show the user. Prefer 1 and do not exceed 3."),
});

export const requestUserInputTool: Tool<typeof ParamsSchema> = {
  name: "request_user_input",
  description:
    "Ask the user 1–3 questions in the user's language and wait for their answers. Use allow_multiple for checkbox-style multi-select, and set is_other explicitly (true when custom answers are helpful, false when only listed options must be allowed).",
  parameters: ParamsSchema,
  async execute(args, ctx) {
    if (!ctx.ask) {
      return { output: "User input not available in this context." };
    }
    const response = await ctx.ask({ questions: args.questions });

    // Treat cancel/blank/no-answer — persist result but abort the agent loop.
    const hasUnanswered = args.questions.some((q) => {
      const answer = response.answers[q.id];
      if (Array.isArray(answer)) {
        if (answer.length === 0) return true;
        return answer.every((value) => value.trim().length === 0);
      }
      return typeof answer !== "string" || answer.trim().length === 0;
    });
    if (hasUnanswered) {
      const summary = args.questions.map((q) => `[${q.header}] ${q.question}`).join("\n");
      return { output: `[Cancelled by user]\n\n${summary}`, abortRequested: true };
    }

    const lines = args.questions.map((q) => {
      const answer = response.answers[q.id];
      const formatted = Array.isArray(answer) ? answer.join(", ") : answer;
      return `[${q.header}] ${q.question}\nAnswer: ${formatted}`;
    });
    return { output: lines.join("\n\n") };
  },
};
