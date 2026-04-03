// @summary Per-tool render strategy map and dispatchers for custom tool input/output rendering

import type { ToolRenderPayload } from "@diligent/protocol";
import {
  buildKnowledgeInputSummary,
  buildPatchInputSummary,
  buildSearchKnowledgeInputSummary,
  clipInlineText,
  createCommandRenderPayload,
  createPatchDiffRenderPayload,
  createTextRenderPayload,
  parsePatchForRender,
  summarizeRenderText,
} from "./render-payload";

/** Strategy for per-tool render customization. */
export interface RenderStrategy {
  startInputSummary?: (parsedInput: Record<string, unknown> | undefined) => string | undefined;
  endRender?: (
    parsedInput: Record<string, unknown> | undefined,
    output: string,
    isError: boolean,
  ) => ToolRenderPayload | undefined;
}

/**
 * Per-tool render strategy map (keyed by normalized tool name).
 * Tools in CUSTOM_RENDER_TOOLS from tool-metadata correspond to entries here.
 * To add a new custom-rendered tool: add an entry to TOOL_CAPABILITIES in
 * tool-metadata.ts, then add a RenderStrategy here.
 */
const RENDER_STRATEGIES: Map<string, RenderStrategy> = new Map([
  [
    "apply_patch",
    {
      startInputSummary: (parsedInput) => {
        const patch = typeof parsedInput?.patch === "string" ? parsedInput.patch : undefined;
        if (!patch) return undefined;
        return buildPatchInputSummary(parsePatchForRender(patch));
      },
      endRender: (parsedInput, output, isError) => {
        const patch = typeof parsedInput?.patch === "string" ? parsedInput.patch : undefined;
        if (patch) {
          const payload = createPatchDiffRenderPayload(patch, output, isError ? "Patch failed" : undefined);
          if (payload) return payload;
        }
        return {
          inputSummary: summarizeRenderText(parsedInput ? JSON.stringify(parsedInput) : "", 120),
          outputSummary: isError ? "Patch failed" : summarizeRenderText(output),
          blocks: [{ type: "text", title: "patch", text: output, isError }],
        };
      },
    },
  ],
  [
    "update_knowledge",
    {
      startInputSummary: (parsedInput) => {
        const contentPreview =
          typeof parsedInput?.content === "string"
            ? clipInlineText(parsedInput.content.replace(/\s+/g, " ").trim(), 140)
            : "";
        return buildKnowledgeInputSummary(parsedInput ?? {}, contentPreview);
      },
    },
  ],
  [
    "search_knowledge",
    {
      startInputSummary: (parsedInput) => buildSearchKnowledgeInputSummary(parsedInput ?? {}),
    },
  ],
  [
    "plan",
    {
      startInputSummary: (parsedInput) => {
        const title = typeof parsedInput?.title === "string" ? parsedInput.title : "Plan";
        const stepCount = Array.isArray(parsedInput?.steps) ? parsedInput.steps.length : 0;
        return summarizeRenderText(`${title} (${stepCount} steps)`, 120);
      },
    },
  ],
  [
    "skill",
    {
      startInputSummary: (parsedInput) => {
        const name = typeof parsedInput?.name === "string" ? parsedInput.name : undefined;
        return summarizeRenderText(name ? `Skill: ${name}` : "Skill", 120);
      },
      endRender: (parsedInput, output, isError) => {
        const name = typeof parsedInput?.name === "string" ? parsedInput.name : "skill";
        const inputSummary = summarizeRenderText(name ? `Skill: ${name}` : "Skill", 120);
        if (isError) {
          return {
            inputSummary,
            outputSummary: summarizeRenderText(output) ?? "Skill failed",
            blocks: [{ type: "text", title: "Error", text: output, isError: true }],
          };
        }
        return {
          inputSummary,
          outputSummary: `Skill "${name}" loaded`,
          blocks: [{ type: "summary", text: `Skill "${name}" loaded`, tone: "success" }],
        };
      },
    },
  ],
  [
    "request_user_input",
    {
      startInputSummary: (parsedInput) => {
        const questions = Array.isArray(parsedInput?.questions) ? parsedInput.questions : [];
        const headers = questions
          .map((q: Record<string, unknown>) => (typeof q?.header === "string" ? q.header : ""))
          .filter(Boolean);
        if (headers.length === 0) return "Asking user…";
        return summarizeRenderText(headers.join(", "), 120);
      },
      endRender: (parsedInput, output, isError) => {
        const questions = Array.isArray(parsedInput?.questions) ? parsedInput.questions : [];
        const headers = questions
          .map((q: Record<string, unknown>) => (typeof q?.header === "string" ? q.header : ""))
          .filter(Boolean);
        const inputSummary = headers.length > 0 ? summarizeRenderText(headers.join(", "), 120) : "User input";

        const cancelled = output.startsWith("[Cancelled by user]");
        if (cancelled) {
          return {
            inputSummary,
            outputSummary: "Cancelled by user",
            blocks: [{ type: "summary", text: "Cancelled by user", tone: "warning" }],
          };
        }

        const answerItems = questions.map((q: Record<string, unknown>) => {
          const header = typeof q?.header === "string" ? q.header : "?";
          const question = typeof q?.question === "string" ? q.question : "";
          return { key: header, value: question };
        });

        const blocks: ToolRenderPayload["blocks"] = [];
        if (answerItems.length > 0) blocks.push({ type: "key_value", title: "Questions", items: answerItems });
        if (isError) {
          blocks.push({ type: "text", title: "Error", text: output, isError: true });
        } else {
          blocks.push({ type: "summary", text: "User input received", tone: "success" });
        }

        return {
          inputSummary,
          outputSummary: isError ? "User input failed" : "User input received",
          blocks,
        };
      },
    },
  ],
  [
    "read",
    {
      startInputSummary: (parsedInput) => {
        const filePath = typeof parsedInput?.file_path === "string" ? parsedInput.file_path : undefined;
        return summarizeRenderText(filePath, 120);
      },
      endRender: (parsedInput, output, isError) => {
        const filePath = typeof parsedInput?.file_path === "string" ? parsedInput.file_path : undefined;
        const outputSummary = isError ? "Read failed" : (summarizeRenderText(output) ?? "Read completed");
        return {
          inputSummary: summarizeRenderText(filePath, 120),
          outputSummary,
          blocks: [{ type: "text", title: filePath ?? "read", text: output, isError }],
        };
      },
    },
  ],
  [
    "write",
    {
      startInputSummary: (parsedInput) => {
        const filePath = typeof parsedInput?.file_path === "string" ? parsedInput.file_path : undefined;
        return summarizeRenderText(filePath, 120);
      },
      endRender: (parsedInput, output, isError) => {
        const filePath = typeof parsedInput?.file_path === "string" ? parsedInput.file_path : undefined;
        return {
          inputSummary: summarizeRenderText(filePath, 120),
          outputSummary: isError ? "Write failed" : "Write completed",
          blocks: [{ type: "text", title: filePath ?? "write", text: output, isError }],
        };
      },
    },
  ],
  [
    "bash",
    {
      startInputSummary: (parsedInput) => {
        const command = typeof parsedInput?.command === "string" ? parsedInput.command : undefined;
        return summarizeRenderText(command, 120);
      },
      endRender: (parsedInput, output, isError) => {
        const command = typeof parsedInput?.command === "string" ? parsedInput.command : undefined;
        if (command?.trim()) return createCommandRenderPayload(command, output, isError);
        return undefined;
      },
    },
  ],
]);

export function createToolStartRenderPayload(toolName: string, input: unknown): ToolRenderPayload | undefined {
  const parsedInput = readRecordInput(input);
  const normalizedToolName = toolName.trim().toLowerCase();
  const strategy = RENDER_STRATEGIES.get(normalizedToolName);
  const inputSummary = strategy?.startInputSummary
    ? strategy.startInputSummary(parsedInput)
    : summarizeRenderText(stringifyInputPreview(input), 120);

  if (!inputSummary) return undefined;
  return {
    inputSummary,
    blocks: [],
  };
}

export function createToolEndRenderPayloadFromInput(args: {
  toolName: string;
  input: unknown;
  output: string;
  isError: boolean;
}): ToolRenderPayload | undefined {
  const normalizedToolName = args.toolName.trim().toLowerCase();
  const parsedInput = readRecordInput(args.input);
  const strategy = RENDER_STRATEGIES.get(normalizedToolName);
  if (strategy?.endRender) {
    const result = strategy.endRender(parsedInput, args.output, args.isError);
    if (result !== undefined) {
      if (args.isError) return ensureErrorBlocks(result, args.output);
      return result;
    }
  }
  const fallback = createTextRenderPayload(
    summarizeRenderText(stringifyInputPreview(args.input), 120),
    args.output,
    args.isError,
  );
  if (fallback && args.isError) return ensureErrorBlocks(fallback, args.output);
  return fallback;
}

/**
 * Ensures an error payload always contains a visible text block with the full
 * error output so users can see what went wrong. If the payload already has a
 * text block with `isError: true`, it is left as-is.
 */
function ensureErrorBlocks(payload: ToolRenderPayload, output: string): ToolRenderPayload {
  const hasErrorText = payload.blocks.some((block) => block.type === "text" && block.isError === true);
  const blocks = hasErrorText
    ? payload.blocks
    : [...payload.blocks, { type: "text" as const, title: "Error", text: output, isError: true as const }];
  return { ...payload, blocks };
}

function readRecordInput(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringifyInputPreview(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
