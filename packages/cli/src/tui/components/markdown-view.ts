// @summary Renders Markdown content with scrolling support
import type { Component } from "../framework/types";
import { renderMarkdown } from "../markdown";

/**
 * Streaming markdown renderer as a Component.
 * Implements newline-gated commit strategy (D047):
 * buffer incoming tokens, render only complete lines,
 * finalize remaining at stream end.
 */
export class MarkdownView implements Component {
  private buffer = "";
  private committedRaw = "";
  private committedLines: string[] = [];
  private lastRenderWidth = 0;

  constructor(private requestRender: () => void) {}

  static fromText(text: string): MarkdownView {
    const view = new MarkdownView(() => {});
    view.committedRaw = text;
    return view;
  }

  /** Push a text delta (streaming token) */
  pushDelta(delta: string): void {
    this.buffer += delta;

    // Newline-gated: commit only complete lines
    const lastNewline = this.buffer.lastIndexOf("\n");
    if (lastNewline !== -1) {
      const complete = this.buffer.slice(0, lastNewline + 1);
      this.buffer = this.buffer.slice(lastNewline + 1);
      this.committedRaw += complete;
      // committedLines will be re-rendered at actual width in render()
      this.committedLines = [];
      this.requestRender();
    }
  }

  /** Finalize — render all remaining buffered content */
  finalize(): void {
    this.committedRaw += this.buffer;
    this.buffer = "";

    if (this.committedRaw.length > 0) {
      // committedLines will be re-rendered at actual width in render()
      this.committedLines = [];
    }

    this.requestRender();
  }

  takeCommittedText(): string {
    if (this.committedRaw.length === 0) {
      return "";
    }

    const text = this.committedRaw;
    this.committedRaw = "";
    this.committedLines = [];
    this.lastRenderWidth = 0;
    return text;
  }

  isEmpty(): boolean {
    return this.committedRaw.length === 0 && this.buffer.length === 0;
  }

  /** Reset for a new message */
  reset(): void {
    this.buffer = "";
    this.committedRaw = "";
    this.committedLines = [];
    this.lastRenderWidth = 0;
  }

  render(width: number): string[] {
    if (this.committedRaw.length === 0 && this.buffer.length === 0) {
      return [];
    }

    // Re-render committed content if width changed or cache is empty
    if (this.committedRaw.length > 0 && (this.committedLines.length === 0 || this.lastRenderWidth !== width)) {
      this.committedLines = this.renderToLines(this.committedRaw, width);
      this.lastRenderWidth = width;
    }

    return this.committedLines;
  }

  invalidate(): void {
    // Force re-render of committed content on next render
  }

  private renderToLines(text: string, width: number): string[] {
    const rendered = renderMarkdown(text, width);
    if (!rendered) return [];
    return rendered.split("\n");
  }
}
