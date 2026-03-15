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
  private finalized = false;
  private lastRenderedLines: string[] = [];

  constructor(private requestRender: () => void) {}

  static fromText(text: string): MarkdownView {
    const view = new MarkdownView(() => {});
    view.committedRaw = text;
    view.finalized = true;
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

    this.finalized = true;
    this.requestRender();
  }

  takeCommittedText(): string {
    if (this.committedRaw.length === 0) {
      return "";
    }

    const text = this.committedRaw;
    this.committedRaw = "";
    this.committedLines = [];
    this.lastRenderedLines = [];
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
    this.finalized = false;
    this.lastRenderedLines = [];
  }

  render(width: number): string[] {
    if (this.committedRaw.length === 0 && this.buffer.length === 0) {
      this.lastRenderedLines = [];
      return [];
    }

    // While streaming trailing text, render full content as markdown so users
    // don't see raw markdown markers (e.g. **, `) in interactive mode.
    if (this.buffer.length > 0 && !this.finalized) {
      this.lastRenderedLines = this.renderToLines(this.committedRaw + this.buffer, width);
      return this.lastRenderedLines;
    }

    // Re-render committed content if width changed or cache is empty
    if (this.committedRaw.length > 0 && (this.committedLines.length === 0 || this.lastRenderWidth !== width)) {
      this.committedLines = this.renderToLines(this.committedRaw, width);
      this.lastRenderWidth = width;
    }

    this.lastRenderedLines = this.committedLines;
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
