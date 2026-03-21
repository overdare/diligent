// @summary Utility helpers for ThreadStore parsing, formatting, and event classification

import type { AgentEvent, ThreadReadResponse, ToolRenderPayload } from "@diligent/protocol";
import { ToolRenderPayloadSchema } from "@diligent/protocol";
import { t } from "../theme";

export const COLLAB_TOOL_NAMES = new Set(["spawn_agent", "wait", "send_input", "close_agent"]);
export const TOOL_MAX_LINES = 5;

export function formatTokensRoundedK(n: number): string {
  return `${Math.round(n / 1000)}k`;
}

export function formatElapsedSeconds(ms: number): string | null {
  if (ms < 1000) return null;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

export function getWorkingSpinnerFrame(nowMs: number): string {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const frameIndex = Math.floor(nowMs / 120) % frames.length;
  return frames[frameIndex] ?? "⠋";
}

export function parseCollabOutput(output: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

export function summarizeCollabLine(value: string, maxChars: number): string {
  const firstLine = value.split("\n")[0] ?? value;
  const chars = Array.from(firstLine);
  if (chars.length <= maxChars) return firstLine;
  return `${chars.slice(0, maxChars).join("")}…`;
}

function summarizeChildText(value: string, maxChars: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (!singleLine) return "";
  const chars = Array.from(singleLine);
  if (chars.length <= maxChars) return singleLine;
  return `${chars.slice(0, maxChars).join("")}…`;
}

export function parseSpawnChildThreadId(output: string): string | undefined {
  const parsed = parseCollabOutput(output);
  const threadId = parsed?.thread_id;
  return typeof threadId === "string" && threadId.trim().length > 0 ? threadId : undefined;
}

export function buildChildDetailLines(payload: ThreadReadResponse): string[] {
  const detailLines: string[] = [];
  let assistantCount = 0;
  let toolCount = 0;

  for (const item of payload.items) {
    if (item.type === "agentMessage") {
      const text = item.message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join(" ");
      const summary = summarizeChildText(text, 140);
      if (summary) {
        assistantCount++;
        detailLines.push(`${t.dim}    assistant: ${summary}${t.reset}`);
      }
      continue;
    }

    if (item.type === "toolCall") {
      toolCount++;
      const status = item.isError ? "error" : typeof item.output === "undefined" ? "running" : "done";
      detailLines.push(`${t.dim}    tool: ${item.toolName} (${status})${t.reset}`);
      if (typeof item.output === "string") {
        const outputPreview = summarizeCollabLine(item.output, 120);
        if (outputPreview) {
          detailLines.push(`${t.dim}      ↳ ${outputPreview}${t.reset}`);
        }
      }
    }
  }

  const previewLimit = 12;
  const previewLines = detailLines.slice(0, previewLimit);
  const omitted = detailLines.length - previewLines.length;
  if (omitted > 0) {
    previewLines.push(`${t.dim}    … +${omitted} more lines${t.reset}`);
  }

  return [
    `${t.dim}  Child thread preview:${t.reset}`,
    `${t.dim}    assistant=${assistantCount}, tools=${toolCount}${t.reset}`,
    ...previewLines,
  ];
}

export function isChildScopedStreamEvent(event: AgentEvent): boolean {
  switch (event.type) {
    case "message_start":
    case "message_delta":
    case "message_end":
    case "tool_start":
    case "tool_update":
    case "tool_end":
      return "childThreadId" in event && typeof event.childThreadId === "string";
    default:
      return false;
  }
}

export function truncateMiddle(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  const head = Math.floor((max - 1) / 2);
  const tail = max - head - 1;
  const omitted = lines.length - head - tail;
  return [...lines.slice(0, head), `… +${omitted} lines`, ...lines.slice(lines.length - tail)];
}

export function buildToolHeader(toolName: string, payload?: ToolRenderPayload): string {
  const inputSummary = payload?.inputSummary?.trim();
  return inputSummary ? `${toolName} - ${inputSummary}` : toolName;
}

export function buildToolSummaryLine(payload?: ToolRenderPayload): string | undefined {
  const outputSummary = payload?.outputSummary?.trim();
  return outputSummary ? `⎿  ${outputSummary}` : undefined;
}

export function toProtocolRenderPayload(value: unknown): ToolRenderPayload | undefined {
  const parsed = ToolRenderPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function mergeToolRenderPayload(
  started: ToolRenderPayload | undefined,
  completed: ToolRenderPayload | undefined,
): ToolRenderPayload | undefined {
  if (!started) return completed;
  if (!completed) return started;
  return {
    ...completed,
    inputSummary: completed.inputSummary ?? started.inputSummary,
  };
}

export function splitThoughtLines(text: string): string[] {
  const lines = text.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}
