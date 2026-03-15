// @summary Renders the agent message history and real-time streaming output

import type { ToolResultMessage } from "@diligent/core";
import type { AgentEvent } from "@diligent/runtime";
import { displayWidth } from "../framework/string-width";
import type { Component } from "../framework/types";
import { MarkdownView } from "./markdown-view";
import { getCommittedTranscriptLineCount, renderTranscript } from "./transcript-render";
import { TranscriptStore, UserMessageView } from "./transcript-store";

export interface ChatViewOptions {
  requestRender: () => void;
}

/**
 * Main conversation view — now a thin adapter over a renderer-agnostic transcript store.
 */
export class ChatView implements Component {
  private store: TranscriptStore;

  constructor(options: ChatViewOptions) {
    this.store = new TranscriptStore(options);
  }

  handleEvent(event: AgentEvent): void {
    this.store.handleEvent(event);
  }

  addUserMessage(text: string): void {
    this.store.addUserMessage(text);
  }

  addLines(lines: string[]): void {
    this.store.addLines(lines);
  }

  addAssistantMessage(text: string): void {
    this.store.addAssistantMessage(text);
  }

  addToolResultMessage(message: ToolResultMessage): void {
    this.store.addToolResultMessage(message);
  }

  addThinkingMessage(text: string, elapsedMs?: number): void {
    this.store.addThinkingMessage(text, elapsedMs);
  }

  toggleToolResultsCollapsed(): void {
    this.store.toggleToolResultsCollapsed();
  }

  clearHistory(): void {
    this.store.clearHistory();
  }

  clearActive(): void {
    this.store.clearActive();
  }

  clearActiveWithCommit(): void {
    this.store.clearActiveWithCommit();
  }

  getLastUsage(): { input: number; output: number; cost: number } | null {
    return this.store.getLastUsage();
  }

  getCommittedLineCount(width: number): number {
    return getCommittedTranscriptLineCount(this.store, width);
  }

  render(width: number): string[] {
    return renderTranscript(this.store, width);
  }

  setActiveQuestion(q: (Component & { handleInput(data: string): void }) | null): void {
    this.store.setActiveQuestion(q);
  }

  hasActiveQuestion(): boolean {
    return this.store.hasActiveQuestion();
  }

  handleQuestionInput(data: string): void {
    this.store.handleQuestionInput(data);
  }

  setPendingSteers(steers: string[]): void {
    this.store.setPendingSteers(steers);
  }

  invalidate(): void {
    this.store.invalidate();
  }
}

export { MarkdownView, TranscriptStore, UserMessageView, displayWidth };
