// @summary Zod schema definitions for DiligentConfig validation and type inference
import { z } from "zod";

export const ModelId = z.string().describe("Model identifier, e.g. 'claude-sonnet-4-6', 'gpt-4o', 'gemini-2.5-flash'");
const ThinkingEffortSchema = z.enum(["low", "medium", "high", "max"]);

export const DiligentConfigSchema = z
  .object({
    $schema: z.string().optional(),

    // Core settings
    model: ModelId.optional(),
    provider: z
      .object({
        anthropic: z
          .object({
            apiKey: z.string().optional(),
            baseUrl: z.string().url().optional(),
          })
          .optional(),
        openai: z
          .object({
            apiKey: z.string().optional(),
            baseUrl: z.string().url().optional(),
          })
          .optional(),
        gemini: z
          .object({
            apiKey: z.string().optional(),
            baseUrl: z.string().url().optional(),
          })
          .optional(),
      })
      .optional(),

    // Agent behavior
    maxTurns: z.number().int().positive().optional(),
    maxRetries: z.number().int().positive().optional(),
    systemPrompt: z.string().optional(),
    systemPromptFile: z.string().optional(),

    // Instructions (D034: concatenated across layers)
    instructions: z.array(z.string()).optional(),

    // Session settings
    session: z
      .object({
        autoResume: z.boolean().optional(),
      })
      .optional(),

    // Knowledge settings (prepared for Phase 3b)
    knowledge: z
      .object({
        enabled: z.boolean().optional(),
        nudgeInterval: z.number().int().positive().optional(),
        injectionBudget: z.number().int().positive().optional(),
        maxItems: z.number().int().positive().optional(),
      })
      .optional(),

    // Compaction settings (prepared for Phase 3b)
    compaction: z
      .object({
        enabled: z.boolean().optional(),
        reservePercent: z.number().min(1).max(100).optional(),
        keepRecentTokens: z.number().int().positive().optional(),
      })
      .optional(),

    // Skills settings (Phase 4b)
    skills: z
      .object({
        enabled: z.boolean().optional(),
        paths: z.array(z.string()).optional(),
      })
      .optional(),

    // Collaboration mode (Phase 4c)
    mode: z.enum(["default", "plan", "execute"]).optional(),
    effort: ThinkingEffortSchema.optional(),

    // Permission rules (Phase 5a — D027, D032)
    permissions: z
      .array(
        z.object({
          permission: z.enum(["read", "write", "execute"]),
          pattern: z.string(),
          action: z.enum(["allow", "deny", "prompt"]),
        }),
      )
      .optional(),

    // YOLO mode — auto-approve all permission prompts without asking
    yolo: z.boolean().optional(),

    // Tool configuration (P032)
    tools: z
      .object({
        builtin: z.record(z.string(), z.boolean()).optional(),
        plugins: z
          .array(
            z.object({
              package: z.string(),
              enabled: z.boolean().optional().default(true),
              tools: z.record(z.string(), z.boolean()).optional(),
            }),
          )
          .optional(),
        conflictPolicy: z.enum(["error", "builtin_wins", "plugin_wins"]).optional(),
      })
      .optional(),
  })
  .strict();

export type DiligentConfig = z.infer<typeof DiligentConfigSchema>;

export const DEFAULT_CONFIG: DiligentConfig = {
  model: "claude-sonnet-4-6",
  effort: "medium",
};
