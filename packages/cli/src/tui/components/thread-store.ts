// @summary Renderer-agnostic transcript state container for chat, tool results, thinking blocks, and active prompts

import type { ToolResultMessage } from "@diligent/core";
import type { AgentEvent, ThreadReadResponse, ToolRenderPayload } from "@diligent/protocol";
import type { Component } from "../framework/types";
import { renderToolPayload } from "../render-blocks";
import { t } from "../theme";
import { MarkdownView } from "./markdown-view";
import {
  type ReducerOverlayStatus,
  type ReducerOverlayStatusKind,
  reduceThreadStoreEvent,
  type ThreadEventReducerDelegate,
} from "./thread-event-reducer";
import { type ThreadItem, UserMessageView } from "./thread-store-primitives";
import {
  buildChildDetailLines,
  buildToolHeader,
  buildToolSummaryLine,
  COLLAB_TOOL_NAMES,
  formatElapsedSeconds,
  formatTokensRoundedK,
  getWorkingSpinnerFrame,
  isChildScopedStreamEvent,
  mergeToolRenderPayload,
  parseCollabOutput,
  parseSpawnChildThreadId,
  splitThoughtLines,
  summarizeCollabLine,
  TOOL_MAX_LINES,
  toProtocolRenderPayload,
  truncateMiddle,
} from "./thread-store-utils";

type OverlayStatusKind = ReducerOverlayStatusKind;

type OverlayStatus = ReducerOverlayStatus;

export interface ThreadStoreOptions {
  requestRender: () => void;
  cwd?: string;
  loadChildThread?: (threadId: string) => Promise<ThreadReadResponse | null>;
}

export class ThreadStore {
  private items: ThreadItem[] = [];
  private activeMarkdown: MarkdownView | null = null;
  private thinkingStartTime: number | null = null;
  private thinkingText = "";
  private overlayStatus: OverlayStatus | null = null;
  private statusBeforeCompaction: string | null = null;
  private isThreadBusy = false;
  private busyStartedAt: number | null = null;
  private statusBlinkVisible = true;
  private statusBlinkStartedAt = Date.now();
  private statusBlinkTimer: ReturnType<typeof setInterval> | null = null;
  private statusRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastUsage: { input: number; output: number; cost: number } | null = null;
  private toolStartTimes = new Map<string, number>();
  private toolCallInputs = new Map<string, unknown>();
  private toolStartRenderByCallId = new Map<string, ToolRenderPayload | undefined>();
  private collabState = new Map<string, { toolName: string; label: string; prompt?: string }>();
  private collabAgentNamesByThreadId = new Map<string, string>();
  private planCallCount = 0;
  private pendingSteers: string[] = [];
  private activeQuestion: (Component & { handleInput(data: string): void }) | null = null;
  private toolResultsExpanded = false;
  private hasCommittedAssistantChunkInMessage = false;
  private childDetailCache = new Map<
    string,
    { status: "loaded"; lines: string[] } | { status: "error"; error: string }
  >();
  private childDetailPending = new Map<string, Promise<void>>();

  constructor(private options: ThreadStoreOptions) {}

  getItems(): ThreadItem[] {
    return this.items;
  }

  drainCommittedItems(): ThreadItem[] {
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
    if (this.overlayStatus) {
      const overlayDot =
        this.overlayStatus.kind === "tool"
          ? this.statusBlinkVisible
            ? `${t.text}⏺${t.reset}`
            : `${t.text} ${t.reset}`
          : this.statusBlinkVisible
            ? `${t.dim}⏺${t.reset}`
            : `${t.dim} ${t.reset}`;
      const message =
        this.overlayStatus.kind === "tool"
          ? `${t.text}${this.overlayStatus.message}${t.reset}`
          : this.overlayStatus.message;
      if (this.isCompleteStatusMessage(this.overlayStatus.message)) {
        lines.push(`${overlayDot} ${message}`);
      } else {
        const overlayElapsed = formatElapsedSeconds(nowMs - this.overlayStatus.startedAt) ?? "0s";
        lines.push(`${overlayDot} ${message} ${t.dim}(${overlayElapsed})${t.reset}`);
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
    if (isChildScopedStreamEvent(event)) {
      return;
    }

    const reduced = reduceThreadStoreEvent(
      {
        items: this.items,
        thinkingStartTime: this.thinkingStartTime,
        thinkingText: this.thinkingText,
        overlayStatus: this.overlayStatus,
        statusBeforeCompaction: this.statusBeforeCompaction,
        isThreadBusy: this.isThreadBusy,
        busyStartedAt: this.busyStartedAt,
        lastUsage: this.lastUsage,
      },
      event,
      {
        nowMs: Date.now(),
        buildCompactionItem: (compactionEvent) => {
          const summaryText = compactionEvent.summary.trim();
          const summaryPrefix = summaryText.length > 0 ? `${summaryText}, ` : "";
          return {
            kind: "plain" as const,
            lines: [
              `${t.success}⏺${t.reset} ${t.dim}Compacted: ${summaryPrefix}${formatTokensRoundedK(compactionEvent.tokensBefore)} → ${formatTokensRoundedK(compactionEvent.tokensAfter)} tokens${t.reset}`,
            ],
          };
        },
        buildKnowledgeSavedItem: () => ({
          kind: "plain" as const,
          lines: [`${t.success}⏺${t.reset} ${t.dim}knowledge saved${t.reset}`],
        }),
        buildErrorItem: (message) => ({
          kind: "plain" as const,
          lines: [`${t.error}✗ ${message}${t.reset}`],
        }),
      },
    );

    if (reduced.handled) {
      this.items = reduced.state.items;
      this.thinkingStartTime = reduced.state.thinkingStartTime;
      this.thinkingText = reduced.state.thinkingText;
      this.overlayStatus = reduced.state.overlayStatus;
      this.statusBeforeCompaction = reduced.state.statusBeforeCompaction;
      this.isThreadBusy = reduced.state.isThreadBusy;
      this.busyStartedAt = reduced.state.busyStartedAt;
      this.lastUsage = reduced.state.lastUsage;

      if (event.type === "status_change" || event.type === "turn_end" || event.type === "error") {
        this.cleanupStatusTimersIfIdle();
      }
      if (event.type === "status_change" && event.status === "busy") {
        this.ensureStatusTimers();
      }
      if (event.type === "agent_start" || event.type === "compaction_start") {
        this.ensureStatusTimers();
      }

      if (reduced.delegate) {
        this.runReducerDelegate(reduced.delegate);
      }

      if (reduced.requestRender) {
        this.options.requestRender();
      }
      return;
    }
  }

  private runReducerDelegate(delegate: ThreadEventReducerDelegate): void {
    switch (delegate.kind) {
      case "message_start":
        this.stopOverlayStatus();
        this.hasCommittedAssistantChunkInMessage = false;
        this.activeMarkdown = new MarkdownView(this.options.requestRender);
        break;
      case "message_delta": {
        const { event } = delegate;
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
        }
        break;
      }
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
      case "tool_start": {
        const { event } = delegate;
        this.toolStartTimes.set(event.toolCallId, Date.now());
        this.toolCallInputs.set(event.toolCallId, event.input);
        this.toolStartRenderByCallId.set(event.toolCallId, toProtocolRenderPayload(event.render));
        if (event.toolName === "plan") {
          const label = this.planCallCount === 0 ? "Planning…" : "Updating plan…";
          this.startOverlayStatus(label, "tool");
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
            if (Array.isArray(ids) && ids.length > 0) {
              const labels = ids.map((id) => {
                if (typeof id !== "string") return String(id);
                return this.collabAgentNamesByThreadId.get(id) ?? id;
              });
              spinnerLabel = `Waiting for ${labels.join(", ")}…`;
            } else {
              spinnerLabel = "Waiting for agents…";
            }
          } else if (event.toolName === "send_input") {
            const targetId = inp?.id as string | undefined;
            spinnerLabel = `Sending to ${
              (targetId ? this.collabAgentNamesByThreadId.get(targetId) : undefined) ?? targetId ?? "agent"
            }…`;
          } else if (event.toolName === "close_agent") {
            const targetId = inp?.id as string | undefined;
            spinnerLabel = `Closing ${
              (targetId ? this.collabAgentNamesByThreadId.get(targetId) : undefined) ?? targetId ?? "agent"
            }…`;
          }
          this.collabState.set(event.toolCallId, { toolName: event.toolName, label: spinnerLabel, prompt });
          this.startOverlayStatus(spinnerLabel, "tool");
        } else {
          this.startOverlayStatus(event.toolName, "tool");
        }
        break;
      }
      case "tool_update": {
        const { event } = delegate;
        if (COLLAB_TOOL_NAMES.has(event.toolName)) {
          const state = this.collabState.get(event.toolCallId);
          if (state) {
            this.setOverlayStatusMessage(`${state.label} — ${event.partialResult}`);
          }
        } else {
          this.startOverlayStatus(`${event.toolName}…`, "tool");
        }
        break;
      }
      case "tool_end":
        this.handleToolEnd(delegate.event);
        break;
    }
  }

  addUserMessage(text: string, options?: { requestRender?: boolean }): void {
    this.items.push(new UserMessageView(text));
    if (options?.requestRender !== false) {
      this.options.requestRender();
    }
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
    const renderPayload: ToolRenderPayload | undefined = toProtocolRenderPayload(message.render);
    const icon = message.isError ? `${t.error}✗${t.reset}` : `${t.success}⏺${t.reset}`;
    const headerLabel = buildToolHeader(message.toolName, renderPayload);

    if (renderPayload) {
      const rendered = renderToolPayload(renderPayload);
      const lines: string[] = [`${icon} ${headerLabel}`];
      if (rendered.length > 0) {
        lines.push(...rendered.map((line) => `  ${line}`));
      }
      this.items.push(this.createToolResultItem(lines, buildToolSummaryLine(renderPayload)));
    } else if (message.output) {
      const rawLines = message.output.split("\n");
      const display = truncateMiddle(rawLines, TOOL_MAX_LINES);
      const lines: string[] = [`${icon} ${headerLabel}`];
      for (const line of display) {
        lines.push(`${t.dim}  ${line}${t.reset}`);
      }
      const item = this.createToolResultItem(lines);
      if (message.toolName === "spawn_agent") {
        const childThreadId = parseSpawnChildThreadId(message.output);
        if (childThreadId) {
          item.childDetail = {
            childThreadId,
            status: "idle",
          };
        }
      }
      this.items.push(item);
    } else {
      this.items.push({ kind: "plain", lines: [`${icon} ${headerLabel}`] });
    }

    this.options.requestRender();
  }

  addThinkingMessage(text: string, elapsedMs?: number): void {
    const icon = `${t.success}⏺${t.reset}`;
    const header =
      elapsedMs !== undefined
        ? `${icon} ${t.bold}Thought for ${formatElapsedSeconds(elapsedMs) ?? "0s"}${t.reset}`
        : `${icon} ${t.bold}Thought${t.reset}`;
    this.items.push({ kind: "thinking", header, bodyLines: splitThoughtLines(text) });
    this.options.requestRender();
  }

  toggleToolResultsCollapsed(): void {
    this.toolResultsExpanded = !this.toolResultsExpanded;
    if (this.toolResultsExpanded) {
      this.loadExpandedChildDetails();
    }
    this.options.requestRender();
  }

  private loadExpandedChildDetails(): void {
    if (!this.options.loadChildThread) return;

    for (const item of this.items) {
      if (item instanceof UserMessageView || item.kind !== "tool_result") continue;
      const detail = item.childDetail;
      if (!detail) continue;

      const cached = this.childDetailCache.get(detail.childThreadId);
      if (cached?.status === "loaded") {
        item.childDetail = { ...detail, status: "loaded", lines: cached.lines, error: undefined };
        continue;
      }
      if (cached?.status === "error") {
        item.childDetail = { ...detail, status: "error", lines: undefined, error: cached.error };
        continue;
      }
      if (detail.status === "loading" || this.childDetailPending.has(detail.childThreadId)) {
        continue;
      }

      item.childDetail = { ...detail, status: "loading", lines: undefined, error: undefined };
      this.options.requestRender();

      const pending = this.options
        .loadChildThread(detail.childThreadId)
        .then((thread) => {
          if (!thread) {
            const error = "child thread not found";
            this.childDetailCache.set(detail.childThreadId, { status: "error", error });
            this.applyChildDetailError(detail.childThreadId, error);
            return;
          }
          const lines = buildChildDetailLines(thread);
          this.childDetailCache.set(detail.childThreadId, { status: "loaded", lines });
          this.applyChildDetailSuccess(detail.childThreadId, lines);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.childDetailCache.set(detail.childThreadId, { status: "error", error: message });
          this.applyChildDetailError(detail.childThreadId, message);
        })
        .finally(() => {
          this.childDetailPending.delete(detail.childThreadId);
        });

      this.childDetailPending.set(detail.childThreadId, pending);
    }
  }

  private applyChildDetailSuccess(childThreadId: string, lines: string[]): void {
    for (const item of this.items) {
      if (item instanceof UserMessageView || item.kind !== "tool_result") continue;
      if (item.childDetail?.childThreadId !== childThreadId) continue;
      item.childDetail = {
        childThreadId,
        status: "loaded",
        lines,
      };
    }
    this.options.requestRender();
  }

  private applyChildDetailError(childThreadId: string, message: string): void {
    for (const item of this.items) {
      if (item instanceof UserMessageView || item.kind !== "tool_result") continue;
      if (item.childDetail?.childThreadId !== childThreadId) continue;
      item.childDetail = {
        childThreadId,
        status: "error",
        error: message,
      };
    }
    this.options.requestRender();
  }

  clearHistory(): void {
    this.clearActive();
    this.items = [];
    this.lastUsage = null;
    this.toolStartTimes.clear();
    this.collabAgentNamesByThreadId.clear();
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
    this.toolStartRenderByCallId.clear();
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
    this.toolStartRenderByCallId.clear();
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

  setPendingSteers(steers: string[], options?: { requestRender?: boolean }): void {
    this.pendingSteers = [...steers];
    if (options?.requestRender !== false) {
      this.options.requestRender();
    }
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

  private createToolResultItem(lines: string[], summaryLine?: string): Extract<ThreadItem, { kind: "tool_result" }> {
    if (lines.length === 0) {
      return { kind: "tool_result", header: "", summaryLine, details: [] };
    }
    return {
      kind: "tool_result",
      header: lines[0],
      summaryLine,
      details: lines.slice(1),
    };
  }

  private handleToolEnd(event: Extract<AgentEvent, { type: "tool_end" }>): void {
    this.stopOverlayStatus();
    const startTime = this.toolStartTimes.get(event.toolCallId);
    this.toolStartTimes.delete(event.toolCallId);
    const startedRender = this.toolStartRenderByCallId.get(event.toolCallId);
    this.toolStartRenderByCallId.delete(event.toolCallId);
    this.toolCallInputs.delete(event.toolCallId);
    const elapsedVal = startTime !== undefined ? formatElapsedSeconds(Date.now() - startTime) : null;
    const elapsed = elapsedVal ? ` ${t.dim}· ${elapsedVal}${t.reset}` : "";
    const renderPayload: ToolRenderPayload | undefined = mergeToolRenderPayload(
      startedRender,
      toProtocolRenderPayload(event.render),
    );

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
            lines.push(`${t.dim}  ${summarizeCollabLine(entry, 160)}${t.reset}`);
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

      const collabItem = this.createToolResultItem(lines);
      if (event.toolName === "spawn_agent") {
        const childThreadId = parseSpawnChildThreadId(event.output);
        const nickname = (parsed?.nickname as string | undefined)?.trim();
        if (childThreadId && nickname) {
          this.collabAgentNamesByThreadId.set(childThreadId, nickname);
        }
        if (childThreadId) {
          collabItem.childDetail = {
            childThreadId,
            status: "idle",
          };
        }
      }
      this.items.push(collabItem);
    } else if (renderPayload) {
      const headerLabel = buildToolHeader(event.toolName, renderPayload);
      const rendered = renderToolPayload(renderPayload);
      const icon = event.isError ? `${t.error}✗${t.reset}` : `${t.success}⏺${t.reset}`;
      const lines: string[] = [`${icon} ${headerLabel}${elapsed}`];
      if (rendered.length > 0) {
        lines.push(...rendered.map((line) => `  ${line}`));
      }
      this.items.push(this.createToolResultItem(lines, buildToolSummaryLine(renderPayload)));
    } else if (event.output) {
      const headerLabel = buildToolHeader(event.toolName);
      const rawLines = event.output.split("\n");
      const display = truncateMiddle(rawLines, TOOL_MAX_LINES);
      const icon = event.isError ? `${t.error}✗${t.reset}` : `${t.success}⏺${t.reset}`;
      const lines: string[] = [`${icon} ${headerLabel}${elapsed}`];
      for (const line of display) {
        lines.push(`${t.dim}  ${line}${t.reset}`);
      }
      const item = this.createToolResultItem(lines);
      this.items.push(item);
    } else {
      const headerLabel = buildToolHeader(event.toolName);
      const icon = event.isError ? `${t.error}✗${t.reset}` : `${t.success}⏺${t.reset}`;
      this.items.push({ kind: "plain", lines: [`${icon} ${headerLabel}${elapsed}`] });
    }
    if (this.isThreadBusy) {
      this.ensureStatusTimers();
    }
    this.options.requestRender();
  }

  private startOverlayStatus(message: string, kind: OverlayStatusKind = "default"): void {
    if (this.overlayStatus === null) {
      this.overlayStatus = {
        message,
        startedAt: Date.now(),
        kind,
      };
      this.ensureStatusTimers();
      this.options.requestRender();
      return;
    }

    const changed = this.overlayStatus.message !== message || this.overlayStatus.kind !== kind;
    this.overlayStatus.message = message;
    this.overlayStatus.kind = kind;
    if (changed) {
      this.overlayStatus.startedAt = Date.now();
      this.statusBlinkVisible = true;
      this.statusBlinkStartedAt = Date.now();
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
        const phaseMs = (Date.now() - this.statusBlinkStartedAt) % 1500;
        this.statusBlinkVisible = phaseMs < 1000;
        this.options.requestRender();
      }, 100);
    }
    if (this.statusRefreshTimer === null) {
      this.statusRefreshTimer = setInterval(() => {
        if (!this.hasVisibleStatus()) return;
        this.options.requestRender();
      }, 120);
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
    this.statusBlinkStartedAt = Date.now();
  }
}

export { UserMessageView };
export type { ThreadItem };
