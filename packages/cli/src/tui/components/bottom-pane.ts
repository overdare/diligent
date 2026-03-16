// @summary Groups live stack, prompt editor, and footer status into a single volatile bottom pane

import type { Component, RenderBlock } from "../framework/types";

export class BottomPane implements Component {
  constructor(
    private liveStack: Component,
    private inputEditor: Component,
    private statusBar: Component,
  ) {}

  render(width: number): string[] {
    return this.renderBlocks(width).flatMap((block) => block.lines);
  }

  renderBlocks(width: number): RenderBlock[] {
    const blocks: RenderBlock[] = [];
    const liveStackBlocks = this.liveStack.renderBlocks?.(width) ?? [
      { key: "live-stack", lines: this.liveStack.render(width), persistence: "volatile" as const },
    ];
    const visibleLiveStackBlocks = liveStackBlocks.filter((block) => block.lines.length > 0);
    const inputLines = this.inputEditor.render(width);
    const statusLines = this.statusBar.render(width);

    if (visibleLiveStackBlocks.length > 0) {
      blocks.push(...visibleLiveStackBlocks);
    }
    if (inputLines.length > 0) {
      blocks.push({ key: "input-padding", lines: [""], persistence: "volatile" });
      blocks.push({ key: "input", lines: inputLines, persistence: "volatile" });
    }
    if (statusLines.length > 0) {
      blocks.push({ key: "status-bar", lines: statusLines, persistence: "volatile" });
    }

    return blocks;
  }

  handleInput(data: string): void {
    this.inputEditor.handleInput?.(data);
  }

  invalidate(): void {
    this.liveStack.invalidate();
    this.inputEditor.invalidate();
    this.statusBar.invalidate();
  }
}
