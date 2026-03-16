// @summary Renderer-agnostic transcript state container for chat, tool results, thinking blocks, and active prompts

import type { ToolResultMessage } from "@diligent/core";
import { type ToolRenderPayload, ToolRenderPayloadSchema } from "@diligent/protocol";
import type { AgentEvent } from "@diligent/runtime";
import { createTextRenderPayload } from "@diligent/runtime/tools";
import { debugLogger } from "../framework/debug-logger";
import type { Component } from "../framework/types";
import { renderToolPayload } from "../render-blocks";
import { t } from "../theme";
import { MarkdownView } from "./markdown-view";

function formatTokensRoundedK(n: number): string {
  return `${Math.round(n / 1000)}k`;
}

function formatToolElapsed(ms: number): string | null {
  if (ms < 500) return null;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}m ${(s % 60).toString().padStart(2, "0")}s`;
}

function formatThoughtElapsed(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}m ${(s % 60).toString().padStart(2, "0")}s`;
}

function getWorkingSpinnerFrame(nowMs: number): string {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const frameIndex = Math.floor(nowMs / 120) % frames.length;
  return frames[frameIndex] ?? "⠋";
}

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
const TOOL_MAX_LINES = 5;

function truncateMiddle(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  const head = Math.floor((max - 1) / 2);
  const tail = max - head - 1;
  const omitted = lines.length - head - tail;
  return [...lines.slice(0, head), `… +${omitted} lines`, ...lines.slice(lines.length - tail)];
}

export class UserMessageView {
  constructor(private text: string) {}

  render(_width: number): string[] {
    return [`${t.bgUser}${t.bold}${t.dim}❯${t.reset}${t.bgUser} ${this.text}${t.reset}`];
  }

  invalidate(): void {}
}

function buildToolHeader(toolName: string, payload?: ToolRenderPayload): string {
  const inputSummary = payload?.inputSummary?.trim();
  return inputSummary ? `${toolName} - ${inputSummary}` : toolName;
}

function stringifyToolInput(input: unknown): string | undefined {
  if (input === null || input === undefined) return undefined;
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function toProtocolRenderPayload(value: unknown): ToolRenderPayload | undefined {
  const parsed = ToolRenderPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function splitThoughtLines(text: string): string[] {
  const lines = text.split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

export type TranscriptItem =
  | {
      kind: "plain";
      lines: string[];
    }
  | {
      kind: "assistant_chunk";
      text: string;
      continued: boolean;
    }
  | {
      kind: "tool_result";
      header: string;
      details: string[];
    }
  | {
      kind: "thinking";
      header: string;
      bodyLines: string[];
    }
  | UserMessageView;

type OverlayStatus = {
  message: string;
  startedAt: number;
};

export interface TranscriptStoreOptions {
  requestRender: () => void;
  cwd?: string;
}

export class TranscriptStore {
  private items: TranscriptItem[] = [];
  private activeMarkdown: MarkdownView | null = null;
  private thinkingStartTime: number | null = null;
  private thinkingText = "";
  private overlayStatus: OverlayStatus | null = null;
  private statusBeforeCompaction: string | null = null;
  private isThreadBusy = false;
  private busyStartedAt: number | null = null;
  private statusBlinkVisible = true;
  private statusBlinkTimer: ReturnType<typeof setInterval> | null = null;
  private statusRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastUsage: { input: number; output: number; cost: number } | null = null;
  private toolStartTimes = new Map<string, number>();
  private toolCallInputs = new Map<string, unknown>();
  private collabState = new Map<string, { toolName: string; label: string; prompt?: string }>();
  private planCallCount = 0;
  private pendingSteers: string[] = [];
  private activeQuestion: (Component & { handleInput(data: string): void }) | null = null;
  private toolResultsExpanded = false;
  private hasCommittedAssistantChunkInMessage = false;

  constructor(private options: TranscriptStoreOptions) {}

  getItems(): TranscriptItem[] {
    return this.items;
  }

  drainCommittedItems(): TranscriptItem[] {
    if (this.items.length === 0) {
      return [];
    }
    const drainedItems = this.items;
    this.items = [];
    return drainedItems;
  }

  getActiveMarkdown(): MarkdownView | null {
    return this.activeMarkdown;
  }

  getActiveQuestion(): (Component & { handleInput(data: string): void }) | null {
    return this.activeQuestion;
  }

  isToolResultsExpanded(): boolean {
    return this.toolResultsExpanded;
  }

  getLastUsage(): { input: number; output: number; cost: number } | null {
    return this.lastUsage;
  }

  getPendingSteers(): string[] {
    return this.pendingSteers;
  }

  renderLiveStackStatusLines(): string[] {
    const lines: string[] = [];
    const nowMs = Date.now();
    const overlayDot = this.statusBlinkVisible ? `${t.dim}⏺${t.reset}` : `${t.dim} ${t.reset}`;

    if (this.overlayStatus) {
      if (this.isCompleteStatusMessage(this.overlayStatus.message)) {
        lines.push(`${overlayDot} ${this.overlayStatus.message}`);
      } else {
        const overlayElapsed = formatThoughtElapsed(nowMs - this.overlayStatus.startedAt);
        lines.push(`${overlayDot} ${this.overlayStatus.message} ${t.dim}(${overlayElapsed})${t.reset}`);
      }
    }

    if (this.busyStartedAt !== null) {
      if (lines.length > 0) {
        lines.push("");
      }
      const spinner = `${t.accent}${getWorkingSpinnerFrame(nowMs)}${t.reset}`;
      lines.push(`${spinner} Working…`);
    }

    return lines;
  }

  shouldPadBelowLiveStatusLine(): boolean {
    return false;
  }

  handleEvent(event: AgentEvent): void {
    debugLogger.logAgentEvent(event);
    switch (event.type) {
      case "agent_start":
        this.startOverlayStatus("Thinking…");
        break;
      case "message_start":
        this.stopOverlayStatus();
        this.hasCommittedAssistantChunkInMessage = false;
        this.activeMarkdown = new MarkdownView(this.options.requestRender);
        break;
      case "message_delta":
        if (event.delta.type === "thinking_delta") {
          this.thinkingText += event.delta.delta;
          if (this.thinkingStartTime === null) {
            this.thinkingStartTime = Date.now();
          }
          this.startOverlayStatus("Thinking…");
        } else if (event.delta.type === "text_delta" && this.activeMarkdown) {
          if (this.thinkingText.length > 0) {
            this.commitThinkingBlock();
          }
          this.activeMarkdown.pushDelta(event.delta.delta);
          this.commitAssistantChunk(this.activeMarkdown);
        }
        break;
      case "message_end":
        if (this.thinkingText.length > 0) {
          this.commitThinkingBlock();
        }
        if (this.activeMarkdown) {
          this.activeMarkdown.finalize();
          this.commitAssistantChunk(this.activeMarkdown);
          this.activeMarkdown = null;
        }
        this.hasCommittedAssistantChunkInMessage = false;
        break;
      case "tool_start":
        this.toolStartTimes.set(event.toolCallId, Date.now());
        this.toolCallInputs.set(event.toolCallId, event.input);
        if (event.toolName === "plan") {
          const label = this.planCallCount === 0 ? "Planning…" : "Updating plan…";
          this.startOverlayStatus(label);
        } else if (COLLAB_TOOL_NAMES.has(event.toolName)) {
          const inp = event.input as Record<string, unknown> | null;
          let spinnerLabel = event.toolName;
          let prompt: string | undefined;
          if (event.toolName === "spawn_agent") {
            const agentType = (inp?.agent_type as string | undefined) ?? "general";
            const desc = (inp?.description as string | undefined) ?? "";
            const promptText = typeof inp?.message === "string" ? inp.message : "";
            const promptSummary = promptText
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
          this.startOverlayStatus(spinnerLabel);
        } else {
          this.startOverlayStatus(event.toolName);
        }
        break;
      case "tool_update":
        if (COLLAB_TOOL_NAMES.has(event.toolName)) {
          const state = this.collabState.get(event.toolCallId);
          if (state) {
            this.setOverlayStatusMessage(`${state.label} — ${event.partialResult}`);
          }
        } else {
          this.setOverlayStatusMessage(`${event.toolName}…`);
        }
        break;
      case "tool_end":
        this.handleToolEnd(event);
        break;
      case "status_change":
        this.isThreadBusy = event.status === "busy";
        if (this.isThreadBusy) {
          if (this.busyStartedAt === null) {
            this.busyStartedAt = Date.now();
          }
          this.ensureStatusTimers();
          this.options.requestRender();
          break;
        }
        this.busyStartedAt = null;
        this.statusBeforeCompaction = null;
        this.cleanupStatusTimersIfIdle();
        this.options.requestRender();
        break;
      case "usage":
        this.lastUsage = {
          input: event.usage.inputTokens,
          output: event.usage.outputTokens,
          cost: event.cost,
        };
        break;
      case "compaction_start":
        this.statusBeforeCompaction = this.overlayStatus?.message ?? null;
        this.startOverlayStatus("Compacting…");
        break;
      case "compaction_end": {
        if (this.statusBeforeCompaction) {
          this.startOverlayStatus(this.statusBeforeCompaction);
        } else {
          this.stopOverlayStatus();
        }
        this.statusBeforeCompaction = null;
        const summaryText = event.summary.trim();
        const summaryPrefix = summaryText.length > 0 ? `${summaryText}, ` : "";
        this.items.push({
          kind: "plain",
          lines: [
            `${t.success}⏺${t.reset} ${t.dim}Compacted: ${summaryPrefix}${formatTokensRoundedK(event.tokensBefore)} → ${formatTokensRoundedK(event.tokensAfter)} tokens${t.reset}`,
          ],
        });
        this.options.requestRender();
        break;
      }
      case "knowledge_saved":
        this.items.push({ kind: "plain", lines: [`${t.success}⏺${t.reset} ${t.dim}knowledge saved${t.reset}`] });
        this.options.requestRender();
        break;
      case "error":
        this.stopOverlayStatus();
        this.thinkingStartTime = null;
        this.thinkingText = "";
        this.items.push({ kind: "plain", lines: [`${t.error}✗ ${event.error.message}${t.reset}`] });
        this.options.requestRender();
        break;
      case "turn_start":
        break;
      case "turn_end":
        this.isThreadBusy = false;
        this.busyStartedAt = null;
        this.statusBeforeCompaction = null;
        this.stopOverlayStatus();
        this.cleanupStatusTimersIfIdle();
        this.options.requestRender();
        break;
      default:
        break;
    }
  }

  addUserMessage(text: string): void {
    this.items.push(new UserMessageView(text));
    this.options.requestRender();
  }

  addLines(lines: string[]): void {
    this.items.push({ kind: "plain", lines });
    this.options.requestRender();
  }

  addAssistantMessage(text: string): void {
    if (!text) return;
    this.items.push({ kind: "assistant_chunk", text, continued: false });
    this.options.requestRender();
  }

  addToolResultMessage(message: ToolResultMessage): void {
    const renderPayload: ToolRenderPayload | undefined =
      toProtocolRenderPayload(message.render) ?? createTextRenderPayload(undefined, message.output, message.isError);
    const icon = message.isError ? `${t.error}✗${t.reset}` : `${t.success}⏺${t.reset}`;
    const headerLabel = buildToolHeader(message.toolName, renderPayload);

    if (renderPayload) {
      const rendered = renderToolPayload(renderPayload);
      const lines: string[] = [`${icon} ${headerLabel}`];
      if (rendered.length > 0) {
        lines.push(...rendered.map((line) => `  ${line}`));
      }
      this.items.push(this.createToolResultItem(lines));
    } else if (message.output) {
      const rawLines = message.output.split("\n");
      const display = truncateMiddle(rawLines, TOOL_MAX_LINES);
      const lines: string[] = [`${icon} ${headerLabel}`];
      for (const line of display) {
        lines.push(`${t.dim}  ${line}${t.reset}`);
      }
      this.items.push(this.createToolResultItem(lines));
    } else {
      this.items.push({ kind: "plain", lines: [`${icon} ${headerLabel}`] });
    }

    this.options.requestRender();
  }

  addThinkingMessage(text: string, elapsedMs?: number): void {
    const icon = `${t.success}⏺${t.reset}`;
    const header =
      elapsedMs !== undefined
        ? `${icon} ${t.bold}Thought for ${formatThoughtElapsed(elapsedMs)}${t.reset}`
        : `${icon} ${t.bold}Thought${t.reset}`;
    this.items.push({ kind: "thinking", header, bodyLines: splitThoughtLines(text) });
    this.options.requestRender();
  }

  toggleToolResultsCollapsed(): void {
    this.toolResultsExpanded = !this.toolResultsExpanded;
    this.options.requestRender();
  }

  clearHistory(): void {
    this.clearActive();
    this.items = [];
    this.lastUsage = null;
    this.toolStartTimes.clear();
    this.options.requestRender();
  }

  clearActive(): void {
    this.isThreadBusy = false;
    this.busyStartedAt = null;
    this.stopOverlayStatus();
    this.cleanupStatusTimersIfIdle();
    this.statusBeforeCompaction = null;
    this.thinkingStartTime = null;
    this.thinkingText = "";
    this.planCallCount = 0;
    this.toolCallInputs.clear();
    this.activeMarkdown = null;
  }

  clearActiveWithCommit(): void {
    this.isThreadBusy = false;
    this.busyStartedAt = null;
    this.stopOverlayStatus();
    this.cleanupStatusTimersIfIdle();
    this.statusBeforeCompaction = null;
    if (this.thinkingText.length > 0) {
      this.commitThinkingBlock();
    }
    this.planCallCount = 0;
    this.toolCallInputs.clear();
    if (this.activeMarkdown) {
      this.activeMarkdown.finalize();
      this.commitAssistantChunk(this.activeMarkdown);
      this.activeMarkdown = null;
    }
    this.options.requestRender();
  }

  finishTurn(): void {
    this.clearActiveWithCommit();
  }

  setActiveQuestion(q: (Component & { handleInput(data: string): void }) | null): void {
    this.activeQuestion = q;
    this.options.requestRender();
  }

  setPendingSteers(steers: string[]): void {
    this.pendingSteers = [...steers];
    this.options.requestRender();
  }

  consumePendingSteers(): string[] {
    if (this.pendingSteers.length === 0) return [];
    const drained = [...this.pendingSteers];
    this.pendingSteers = [];
    this.options.requestRender();
    return drained;
  }

  hasActiveQuestion(): boolean {
    return this.activeQuestion !== null;
  }

  handleQuestionInput(data: string): void {
    this.activeQuestion?.handleInput(data);
  }

  invalidate(): void {
    for (const item of this.items) {
      if (item instanceof UserMessageView) {
        item.invalidate();
      }
    }
    this.activeMarkdown?.invalidate();
  }

  private commitThinkingBlock(): void {
    this.stopOverlayStatus();
    if (this.thinkingText.length > 0) {
      const elapsedMs = this.thinkingStartTime !== null ? Date.now() - this.thinkingStartTime : undefined;
      this.addThinkingMessage(this.thinkingText, elapsedMs);
    }
    this.thinkingStartTime = null;
    this.thinkingText = "";
    this.options.requestRender();
  }

  private createToolResultItem(lines: string[]): TranscriptItem {
    if (lines.length === 0) {
      return { kind: "plain", lines };
    }
    return {
      kind: "tool_result",
      header: lines[0],
      details: lines.slice(1),
    };
  }

  private handleToolEnd(event: Extract<AgentEvent, { type: "tool_end" }>): void {
    this.stopOverlayStatus();
    const startTime = this.toolStartTimes.get(event.toolCallId);
    this.toolStartTimes.delete(event.toolCallId);
    const toolInput = this.toolCallInputs.get(event.toolCallId);
    this.toolCallInputs.delete(event.toolCallId);
    const elapsedVal = startTime !== undefined ? formatToolElapsed(Date.now() - startTime) : null;
    const elapsed = elapsedVal ? ` ${t.dim}· ${elapsedVal}${t.reset}` : "";
    const renderPayload: ToolRenderPayload | undefined =
      toProtocolRenderPayload(event.render) ??
      createTextRenderPayload(stringifyToolInput(toolInput), event.output, event.isError);

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

      this.items.push({ kind: "plain", lines });
    } else if (event.toolName === "skill") {
      const icon = event.isError ? `${t.error}✗${t.reset}` : `${t.success}⏺${t.reset}`;
      const match = event.output.match(/<skill_content\s+name="([^"]+)"/);
      const skillName = match?.[1];
      const label = skillName ? `Loaded skill: ${skillName}` : "Loaded skill";
      this.items.push({ kind: "plain", lines: [`${icon} ${label}${elapsed}`] });
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
            lines.push(`${t.dim}  ${i === 0 ? `prompt: ${promptLines[i]}` : promptLines[i]}${t.reset}`);
          }
        }
      } else if (event.toolName === "wait") {
        lines.push(`${icon} Finished waiting${elapsed}`);
        if (parsed?.summary && Array.isArray(parsed.summary)) {
          for (const entry of parsed.summary as string[]) {
            lines.push(`${t.dim}  ${entry}${t.reset}`);
          }
        }
        if (parsed?.timed_out) {
          lines.push(`${t.warn}  Timed out${t.reset}`);
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

      this.items.push(this.createToolResultItem(lines));
    } else if (renderPayload) {
      const headerLabel = buildToolHeader(event.toolName, renderPayload);
      const rendered = renderToolPayload(renderPayload);
      const lines: string[] = [`${t.success}⏺${t.reset} ${headerLabel}${elapsed}`];
      if (rendered.length > 0) {
        lines.push(...rendered.map((line) => `  ${line}`));
      }
      this.items.push(this.createToolResultItem(lines));
    } else if (event.output) {
      const headerLabel = buildToolHeader(
        event.toolName,
        createTextRenderPayload(stringifyToolInput(toolInput), event.output, event.isError),
      );
      const rawLines = event.output.split("\n");
      const display = truncateMiddle(rawLines, TOOL_MAX_LINES);
      const lines: string[] = [`${t.success}⏺${t.reset} ${headerLabel}${elapsed}`];
      for (const line of display) {
        lines.push(`${t.dim}  ${line}${t.reset}`);
      }
      this.items.push(this.createToolResultItem(lines));
    } else {
      const headerLabel = buildToolHeader(event.toolName);
      this.items.push({ kind: "plain", lines: [`${t.success}⏺${t.reset} ${headerLabel}${elapsed}`] });
    }
    if (this.isThreadBusy) {
      this.ensureStatusTimers();
    }
    this.options.requestRender();
  }

  private startOverlayStatus(message: string): void {
    if (this.overlayStatus === null) {
      this.overlayStatus = {
        message,
        startedAt: Date.now(),
      };
      this.ensureStatusTimers();
      this.options.requestRender();
      return;
    }

    const changed = this.overlayStatus.message !== message;
    this.overlayStatus.message = message;
    if (changed) {
      this.overlayStatus.startedAt = Date.now();
      this.statusBlinkVisible = true;
    }
    this.ensureStatusTimers();
    this.options.requestRender();
  }

  private setOverlayStatusMessage(message: string): void {
    if (this.overlayStatus === null) {
      this.startOverlayStatus(message);
      return;
    }
    this.overlayStatus.message = message;
    this.options.requestRender();
  }

  private isCompleteStatusMessage(message: string): boolean {
    const normalized = message.trim();
    return normalized === "Complete" || normalized.startsWith("Complete") || normalized.includes("Complete");
  }

  private commitAssistantChunk(markdown: MarkdownView): void {
    const text = markdown.takeCommittedText();
    if (!text) return;
    this.items.push({
      kind: "assistant_chunk",
      text,
      continued: this.hasCommittedAssistantChunkInMessage,
    });
    this.hasCommittedAssistantChunkInMessage = true;
  }

  private stopOverlayStatus(): void {
    if (!this.overlayStatus) return;
    this.overlayStatus = null;
    this.cleanupStatusTimersIfIdle();
  }

  private hasVisibleStatus(): boolean {
    return this.overlayStatus !== null || this.busyStartedAt !== null;
  }

  private ensureStatusTimers(): void {
    if (!this.hasVisibleStatus()) return;
    if (this.statusBlinkTimer === null) {
      this.statusBlinkTimer = setInterval(() => {
        if (!this.hasVisibleStatus()) return;
        this.statusBlinkVisible = !this.statusBlinkVisible;
        this.options.requestRender();
      }, 500);
    }
    if (this.statusRefreshTimer === null) {
      this.statusRefreshTimer = setInterval(() => {
        if (!this.hasVisibleStatus()) return;
        this.options.requestRender();
      }, 150);
    }
  }

  private cleanupStatusTimersIfIdle(): void {
    if (this.hasVisibleStatus()) return;
    if (this.statusBlinkTimer !== null) {
      clearInterval(this.statusBlinkTimer);
      this.statusBlinkTimer = null;
    }
    if (this.statusRefreshTimer !== null) {
      clearInterval(this.statusRefreshTimer);
      this.statusRefreshTimer = null;
    }
    this.statusBlinkVisible = true;
  }
}
