// @summary Per-agent progress tracking for collab sub-agents and the compact digest `wait` reports on timeout

import type { TextBlock } from "@diligent/core/message-contract";
import type { AgentEvent } from "../agent-event";

const LAST_MESSAGE_CHARS = 160;

interface ActiveTool {
  label: string;
  startedAt: number;
}

/** Mutable progress state the registry updates from a child's event stream. */
export class AgentProgressTracker {
  private turns = 0;
  private toolCalls = 0;
  private readonly activeTools = new Map<string, ActiveTool>();
  private lastTool: { label: string; endedAt: number; isError: boolean } | undefined;
  private lastMessage: string | undefined;
  private lastEventAt: number;

  constructor(now = Date.now()) {
    this.lastEventAt = now;
  }

  record(event: AgentEvent, now = Date.now()): void {
    this.lastEventAt = now;
    switch (event.type) {
      case "turn_start":
        this.turns++;
        return;
      case "tool_start": {
        this.toolCalls++;
        // Calls nested in a code mode `exec` are labelled under it, e.g. `exec > bash`.
        const parent = event.parentToolCallId ? this.activeTools.get(event.parentToolCallId) : undefined;
        this.activeTools.set(event.toolCallId, {
          label: parent ? `${parent.label} > ${event.toolName}` : event.toolName,
          startedAt: now,
        });
        return;
      }
      case "tool_end": {
        const active = this.activeTools.get(event.toolCallId);
        this.activeTools.delete(event.toolCallId);
        this.lastTool = { label: active?.label ?? event.toolName, endedAt: now, isError: event.isError };
        return;
      }
      case "message_end": {
        const text = event.message.content
          .filter((block): block is TextBlock => block.type === "text")
          .map((block) => block.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (text)
          this.lastMessage = text.length > LAST_MESSAGE_CHARS ? `${text.slice(0, LAST_MESSAGE_CHARS - 1)}…` : text;
        return;
      }
    }
  }

  snapshot(now = Date.now()): AgentProgress {
    const current = [...this.activeTools.values()].at(-1);
    return {
      turns: this.turns,
      tool_calls: this.toolCalls,
      ...(current ? { current_tool: { name: current.label, running_ms: now - current.startedAt } } : {}),
      ...(!current && this.lastTool
        ? {
            last_tool: {
              name: this.lastTool.label,
              ended_ms_ago: now - this.lastTool.endedAt,
              ...(this.lastTool.isError ? { is_error: true } : {}),
            },
          }
        : {}),
      ...(this.lastMessage ? { last_message: this.lastMessage } : {}),
      idle_ms: now - this.lastEventAt,
    };
  }
}

/** Progress digest of a running sub-agent, as returned in the `wait` tool output (snake_case wire shape). */
export interface AgentProgress {
  turns: number;
  tool_calls: number;
  current_tool?: { name: string; running_ms: number };
  last_tool?: { name: string; ended_ms_ago: number; is_error?: true };
  last_message?: string;
  /** Time since the child emitted any event. */
  idle_ms: number;
}

/** One-line digest, e.g. `turn 3, 12 tool calls, running bash for 42s, last message: "..."`. */
export function formatAgentProgress(progress: AgentProgress): string {
  const parts = [`turn ${progress.turns}`, `${progress.tool_calls} tool call${progress.tool_calls === 1 ? "" : "s"}`];
  if (progress.current_tool) {
    parts.push(`running ${progress.current_tool.name} for ${formatDuration(progress.current_tool.running_ms)}`);
  } else if (progress.last_tool) {
    const failed = progress.last_tool.is_error ? " (failed)" : "";
    parts.push(`last tool ${progress.last_tool.name}${failed} ${formatDuration(progress.last_tool.ended_ms_ago)} ago`);
  }
  if (progress.last_message) parts.push(`last message: "${progress.last_message}"`);
  return parts.join(", ");
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(seconds % 60).padStart(2, "0")}s`;
}
