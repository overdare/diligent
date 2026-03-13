// @summary Renders the agent message history and real-time streaming output
import type { AgentEvent } from "@diligent/core";
import { debugLogger } from "../framework/debug-logger";
import { displayWidth } from "../framework/string-width";
import type { Component } from "../framework/types";
import { t } from "../theme";
import { MarkdownView } from "./markdown-view";
import { SpinnerComponent } from "./spinner";

function formatTokensCompact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

function formatToolElapsed(ms: number): string | null {
  if (ms < 500) return null;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}m ${(s % 60).toString().padStart(2, "0")}s`;
}

/** Parse JSON output from collab tools, returning null on failure. */
function parseCollabOutput(output: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(output);
    if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

const COLLAB_TOOL_NAMES = new Set(["spawn_agent", "wait", "send_input", "close_agent"]);

/** Middle-truncate lines to at most `max`, inserting `… +N lines` in the middle */
function truncateMiddle(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  const head = Math.floor((max - 1) / 2);
  const tail = max - head - 1;
  const omitted = lines.length - head - tail;
  return [...lines.slice(0, head), `… +${omitted} lines`, ...lines.slice(lines.length - tail)];
}

/** User message rendered with a subtle background color (width-aware) */
class UserMessageView {
  constructor(private text: string) {}

  render(width: number): string[] {
    const visibleLen = 3 + displayWidth(this.text); // " › " = 3 visible chars
    const padding = " ".repeat(Math.max(0, width - visibleLen));
    return [`${t.bgUser} ${t.bold}${t.dim}›${t.reset}${t.bgUser} ${this.text}${padding}${t.reset}`];
  }

  invalidate(): void {}
}

export interface ChatViewOptions {
  requestRender: () => void;
}

/** A committed item in the chat history */
type ChatItem = string[] | MarkdownView | UserMessageView;

const TOOL_MAX_LINES = 5;

/**
 * Main conversation view — message list, streaming output, tool execution display.
 * Composes MarkdownView and SpinnerComponent internally.
 */
export class ChatView implements Component {
  private items: ChatItem[] = [];
  private activeMarkdown: MarkdownView | null = null;
  private activeSpinner: SpinnerComponent;
  private thinkingSpinner: SpinnerComponent;
  private thinkingStartTime: number | null = null;
  private thinkingText = "";
  private lastUsage: { input: number; output: number; cost: number } | null = null;
  private toolStartTimes = new Map<string, number>();
  private collabState = new Map<string, { toolName: string; label: string; prompt?: string }>();
  private planCallCount = 0;
  private activeQuestion: (Component & { handleInput(data: string): void }) | null = null;

  constructor(private options: ChatViewOptions) {
    this.activeSpinner = new SpinnerComponent(options.requestRender);
    this.thinkingSpinner = new SpinnerComponent(options.requestRender);
  }

  /** Handle agent events to update the view */
  handleEvent(event: AgentEvent): void {
    debugLogger.logAgentEvent(event);
    switch (event.type) {
      case "agent_start":
        this.activeSpinner.start("Thinking\u2026");
        break;

      case "message_start":
        this.activeSpinner.stop();
        this.activeMarkdown = new MarkdownView(this.options.requestRender);
        break;

      case "message_delta":
        if (event.delta.type === "thinking_delta") {
          this.thinkingText += event.delta.delta;
          if (!this.thinkingSpinner.isRunning) {
            this.thinkingStartTime = Date.now();
            this.thinkingSpinner.start("Thinking\u2026");
          }
        } else if (event.delta.type === "text_delta" && this.activeMarkdown) {
          if (this.thinkingSpinner.isRunning) {
            this.commitThinkingBlock();
          }
          this.activeMarkdown.pushDelta(event.delta.delta);
        }
        break;

      case "message_end":
        if (this.thinkingSpinner.isRunning) {
          this.commitThinkingBlock();
        }
        if (this.activeMarkdown) {
          this.activeMarkdown.finalize();
          this.items.push(this.activeMarkdown);
          this.activeMarkdown = null;
        }
        break;

      case "tool_start":
        this.toolStartTimes.set(event.toolCallId, Date.now());
        if (event.toolName === "plan") {
          const label = this.planCallCount === 0 ? "Planning\u2026" : "Updating plan\u2026";
          this.activeSpinner.start(label);
        } else if (COLLAB_TOOL_NAMES.has(event.toolName)) {
          const inp = event.input as Record<string, unknown> | null;
          let spinnerLabel = event.toolName;
          let prompt: string | undefined;
          if (event.toolName === "spawn_agent") {
            const agentType = (inp?.agent_type as string | undefined) ?? "general";
            const desc = (inp?.description as string | undefined) ?? "";
            const promptText = typeof inp?.message === "string" ? inp.message : "";
            const promptSummary = prompt
              ? promptText.split("\n")[0].trim().slice(0, 72) + (promptText.length > 72 ? "…" : "")
              : "";
            spinnerLabel = desc
              ? `Spawning [${agentType}] ${desc}…`
              : promptSummary
                ? `Spawning [${agentType}] ${promptSummary}`
                : `Spawning [${agentType}]…`;
            prompt = promptText || undefined;
          } else if (event.toolName === "wait") {
            const ids = inp?.ids;
            spinnerLabel = `Waiting for ${Array.isArray(ids) ? ids.join(", ") : "agents"}…`;
          } else if (event.toolName === "send_input") {
            spinnerLabel = `Sending to ${(inp?.id as string | undefined) ?? "agent"}…`;
          } else if (event.toolName === "close_agent") {
            spinnerLabel = `Closing ${(inp?.id as string | undefined) ?? "agent"}…`;
          }
          this.collabState.set(event.toolCallId, { toolName: event.toolName, label: spinnerLabel, prompt });
          this.activeSpinner.start(spinnerLabel);
        } else {
          this.activeSpinner.start(event.toolName);
        }
        break;

      case "tool_update":
        if (COLLAB_TOOL_NAMES.has(event.toolName)) {
          const state = this.collabState.get(event.toolCallId);
          if (state) {
            this.activeSpinner.setMessage(`${state.label} — ${event.partialResult}`);
          }
        } else {
          this.activeSpinner.setMessage(`${event.toolName}…`);
        }
        break;

      case "tool_end": {
        this.activeSpinner.stop();
        const startTime = this.toolStartTimes.get(event.toolCallId);
        this.toolStartTimes.delete(event.toolCallId);
        const elapsedVal = startTime !== undefined ? formatToolElapsed(Date.now() - startTime) : null;
        const elapsed = elapsedVal ? ` ${t.dim}· ${elapsedVal}${t.reset}` : "";

        if (event.toolName === "plan") {
          this.planCallCount++;
          const parsed = parseCollabOutput(event.output);
          const isUpdate = this.planCallCount > 1;
          const header = isUpdate ? "Updated Plan" : ((parsed?.title as string | undefined) ?? "Plan");
          const icon = event.isError ? `${t.error}✗${t.reset}` : `${t.success}⏺${t.reset}`;
          const lines: string[] = [`${icon} ${t.bold}${header}${t.reset}${elapsed}`];

          if (parsed?.steps && Array.isArray(parsed.steps)) {
            for (const step of parsed.steps as Array<{
              text: string;
              status?: "pending" | "in_progress" | "done";
              done?: boolean;
            }>) {
              const status = step.status ?? (step.done ? "done" : "pending");
              const check =
                status === "done" ? `${t.success}☑${t.reset}` : status === "in_progress" ? "▶" : `${t.dim}☐${t.reset}`;
              const text = status === "done" ? `${t.dim}${step.text}${t.reset}` : step.text;
              lines.push(`  ${check} ${text}`);
            }
          }

          this.items.push(lines);
        } else if (event.toolName === "skill") {
          const icon = event.isError ? `${t.error}✗${t.reset}` : `${t.success}⏺${t.reset}`;
          const match = event.output.match(/<skill_content\s+name="([^"]+)"/);
          const skillName = match?.[1];
          const label = skillName ? `Loaded skill: ${skillName}` : "Loaded skill";
          this.items.push([`${icon} ${label}${elapsed}`]);
        } else if (COLLAB_TOOL_NAMES.has(event.toolName)) {
          const state = this.collabState.get(event.toolCallId);
          this.collabState.delete(event.toolCallId);
          const icon = event.isError ? `${t.error}✗${t.reset}` : `${t.success}⏺${t.reset}`;
          const parsed = parseCollabOutput(event.output);
          const lines: string[] = [];

          if (event.toolName === "spawn_agent") {
            const nickname = (parsed?.nickname as string | undefined) ?? "agent";
            const inp = state?.label ?? "";
            const typeMatch = inp.match(/\[(\w+)\]/);
            const agentType = typeMatch ? typeMatch[1] : "general";
            lines.push(`${icon} Spawned ${t.bold}${nickname}${t.reset} [${agentType}]${elapsed}`);
            const prompt = state?.prompt;
            if (typeof prompt === "string" && prompt.trim()) {
              const promptLines = truncateMiddle(prompt.trim().split("\n"), TOOL_MAX_LINES);
              for (let i = 0; i < promptLines.length; i++) {
                if (i === 0) {
                  lines.push(`${t.dim}  └ prompt: ${promptLines[i]}${t.reset}`);
                } else {
                  lines.push(`${t.dim}    ${promptLines[i]}${t.reset}`);
                }
              }
            }
          } else if (event.toolName === "wait") {
            lines.push(`${icon} Finished waiting${elapsed}`);
            if (parsed?.summary && Array.isArray(parsed.summary)) {
              for (const entry of parsed.summary as string[]) {
                lines.push(`${t.dim}  └ ${entry}${t.reset}`);
              }
            }
            if (parsed?.timed_out) {
              lines.push(`${t.warn}  └ Timed out${t.reset}`);
            }
          } else if (event.toolName === "send_input") {
            const nickname = (parsed?.nickname as string | undefined) ?? "agent";
            lines.push(`${icon} Sent input → ${t.bold}${nickname}${t.reset}${elapsed}`);
          } else if (event.toolName === "close_agent") {
            const nickname = (parsed?.nickname as string | undefined) ?? "agent";
            lines.push(`${icon} Closed ${t.bold}${nickname}${t.reset}${elapsed}`);
          } else {
            lines.push(`${icon} ${event.toolName}${elapsed}`);
          }

          this.items.push(lines);
        } else if (event.output) {
          const rawLines = event.output.split("\n");
          const display = truncateMiddle(rawLines, TOOL_MAX_LINES);
          const lines: string[] = [`${t.success}⏺${t.reset} ${event.toolName}${elapsed}`];
          for (let i = 0; i < display.length; i++) {
            const isEllipsis = display[i].startsWith("… +");
            if (isEllipsis) {
              lines.push(`${t.dim}    ${display[i]}${t.reset}`);
            } else if (i === 0) {
              lines.push(`${t.dim}  └ ${display[i]}${t.reset}`);
            } else {
              lines.push(`${t.dim}    ${display[i]}${t.reset}`);
            }
          }
          this.items.push(lines);
        } else {
          this.items.push([`${t.success}⏺${t.reset} ${event.toolName}${elapsed}`]);
        }
        this.options.requestRender();
        break;
      }

      case "status_change":
        if (event.status === "retry" && event.retry) {
          this.activeSpinner.start(
            `Retrying (attempt ${event.retry.attempt}, waiting ${Math.round(event.retry.delayMs / 1000)}s)…`,
          );
        }
        break;

      case "usage":
        // Track for StatusBar — not displayed in chat
        this.lastUsage = {
          input: event.usage.inputTokens,
          output: event.usage.outputTokens,
          cost: event.cost,
        };
        break;

      case "compaction_start":
        // Compaction progress is shown via overlay dialog (managed by App)
        break;

      case "compaction_end": {
        this.activeSpinner.stop();
        const tailInfo = event.tailMessages?.length ? ` [${event.tailMessages.map((m) => m.role).join(" → ")}]` : "";
        this.items.push([
          `${t.success}⏺${t.reset} ${t.dim}compacted: ${formatTokensCompact(event.tokensBefore)} → ${formatTokensCompact(event.tokensAfter)}${tailInfo}${t.reset}`,
        ]);
        this.options.requestRender();
        break;
      }

      case "knowledge_saved":
        this.items.push([`${t.success}⏺${t.reset} ${t.dim}knowledge saved${t.reset}`]);
        this.options.requestRender();
        break;

      case "error":
        this.activeSpinner.stop();
        this.thinkingSpinner.stop();
        this.thinkingStartTime = null;
        this.thinkingText = "";
        this.items.push([`${t.error}✗ ${event.error.message}${t.reset}`]);
        this.options.requestRender();
        break;

      case "turn_start":
        break;

      case "turn_end":
        if (event.toolResults.length > 0) {
          this.activeSpinner.start("Thinking\u2026");
        }
        break;

      default:
        break;
    }
  }

  /** Add a user message to the display */
  addUserMessage(text: string): void {
    this.items.push(new UserMessageView(text));
    this.options.requestRender();
  }

  /** Add raw lines to the display (used for banners, tips, etc.) */
  addLines(lines: string[]): void {
    this.items.push(lines);
    this.options.requestRender();
  }

  /** Add a completed assistant message from history (rendered via MarkdownView) */
  addAssistantMessage(text: string): void {
    const view = new MarkdownView(this.options.requestRender);
    view.pushDelta(text);
    view.finalize();
    this.items.push(view);
    this.options.requestRender();
  }

  /** Commit accumulated thinking block as a collapsed indicator */
  private commitThinkingBlock(): void {
    this.thinkingSpinner.stop();
    if (this.thinkingText.length > 0) {
      const elapsedVal =
        this.thinkingStartTime !== null ? formatToolElapsed(Date.now() - this.thinkingStartTime) : null;
      const elapsedStr = elapsedVal ? ` ${t.dim}\xb7 ${elapsedVal}${t.reset}` : "";
      this.items.push([`${t.dim}\u25b8 Thinking${elapsedStr}${t.reset}`]);
    }
    this.thinkingStartTime = null;
    this.thinkingText = "";
    this.options.requestRender();
  }

  /** Reset the chat history and all active state (for new thread). */
  clearHistory(): void {
    this.clearActive();
    this.items = [];
    this.lastUsage = null;
    this.toolStartTimes.clear();
    this.options.requestRender();
  }

  /** Stop all active spinners and discard streaming state. */
  clearActive(): void {
    this.activeSpinner.stop();
    this.thinkingSpinner.stop();
    this.thinkingStartTime = null;
    this.thinkingText = "";
    this.planCallCount = 0;
    if (this.activeMarkdown) {
      this.activeMarkdown.finalize();
      this.activeMarkdown = null;
    }
  }

  /** Get last usage info (for StatusBar) */
  getLastUsage(): { input: number; output: number; cost: number } | null {
    return this.lastUsage;
  }

  getCommittedLineCount(width: number): number {
    let count = 0;
    for (let i = 0; i < this.items.length; i++) {
      if (i > 0 && count > 0) count++; // blank line between items
      const item = this.items[i];
      if (Array.isArray(item)) {
        count += item.length;
      } else {
        count += item.render(width).length;
      }
    }
    return count;
  }

  render(width: number): string[] {
    const result: string[] = [];
    const TURN_MARKER = `${t.dim}⏺${t.reset} `;

    for (let i = 0; i < this.items.length; i++) {
      if (i > 0 && result.length > 0) result.push("");
      const item = this.items[i];
      if (item instanceof MarkdownView) {
        const lines = item.render(width);
        if (lines.length > 0) {
          result.push(TURN_MARKER + lines[0], ...lines.slice(1));
        }
      } else if (Array.isArray(item)) {
        result.push(...item);
      } else {
        result.push(...item.render(width));
      }
    }

    // Add active thinking spinner
    if (this.thinkingSpinner.isRunning) {
      if (result.length > 0) result.push("");
      result.push(...this.thinkingSpinner.render(width));
    }

    // Add active streaming markdown
    if (this.activeMarkdown) {
      const lines = this.activeMarkdown.render(width);
      if (lines.length > 0) {
        if (result.length > 0) result.push("");
        result.push(TURN_MARKER + lines[0], ...lines.slice(1));
      }
    }

    // Add active spinner
    if (this.activeSpinner.isRunning) {
      if (result.length > 0) result.push("");
      result.push(...this.activeSpinner.render(width));
    }

    // Add inline question input (request_user_input)
    if (this.activeQuestion) {
      if (result.length > 0) result.push("");
      result.push(...this.activeQuestion.render(width));
    }

    return result;
  }

  /** Show an interactive question inline in the chat stream */
  setActiveQuestion(q: (Component & { handleInput(data: string): void }) | null): void {
    this.activeQuestion = q;
    this.options.requestRender();
  }

  hasActiveQuestion(): boolean {
    return this.activeQuestion !== null;
  }

  handleQuestionInput(data: string): void {
    this.activeQuestion?.handleInput(data);
  }

  invalidate(): void {
    for (const item of this.items) {
      if (!Array.isArray(item)) {
        item.invalidate();
      }
    }
    this.activeMarkdown?.invalidate();
    this.thinkingSpinner.invalidate();
    this.activeSpinner.invalidate();
  }
}
