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
    .min(2)
    .max(3)
    .describe(
      'Provide 2-3 mutually exclusive choices. Put the recommended option first and suffix its label with "(Recommended)". Do not include an "Other" option in this list; the client will add a free-form "Other" option automatically.',
    ),
  is_secret: z.boolean().optional().describe("If true, mask the input (e.g. passwords)."),
});

const ParamsSchema = z.object({
  questions: z.array(QuestionSchema).min(1).max(3).describe("Questions to show the user. Prefer 1 and do not exceed 3."),
});

export const requestUserInputTool: Tool<typeof ParamsSchema> = {
  name: "request_user_input",
  description: "Ask the user 1–3 questions and wait for their answers before proceeding.",
  parameters: ParamsSchema,
  async execute(args, ctx) {
    if (!ctx.ask) {
      return { output: "User input not available in this context." };
    }
    const response = await ctx.ask({ questions: args.questions });
    const lines = args.questions.map(
      (q) => `[${q.header}] ${q.question}\nAnswer: ${response.answers[q.id] ?? "(no answer)"}`,
    );
    return { output: lines.join("\n\n") };
  },
};
