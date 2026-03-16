// @summary Footer status bar displaying mode and connection information

import type { Component } from "../framework/types";
import { renderStatusBar } from "./status-bar-render";
import { type StatusBarInfo, StatusBarStore } from "./status-bar-store";

/** Bottom status bar showing model, tokens, session info */
export class StatusBar implements Component {
  private store = new StatusBarStore();
  private lastRenderCache: {
    width: number;
    viewportRows: number | null;
    lineCount: number;
    text: string;
    lines: string[];
  } | null = null;

  update(info: Partial<StatusBarInfo>): void {
    this.store.update(info);
  }

  resetUsage(): void {
    this.store.resetUsage();
  }

  render(width: number): string[] {
    const lines = renderStatusBar(this.store, width);
    const text = lines.join("\n");
    const lineCount = lines.length;
    const viewportRows = typeof process.stdout.rows === "number" ? process.stdout.rows : null;
    const cached = this.lastRenderCache;

    const shouldReuseCache =
      !!cached &&
      cached.width === width &&
      cached.viewportRows === viewportRows &&
      cached.lineCount === lineCount &&
      cached.text === text;

    if (shouldReuseCache) {
      return cached.lines;
    }

    this.lastRenderCache = { width, viewportRows, lineCount, text, lines };
    return lines;
  }

  invalidate(): void {}
}

export type { StatusBarInfo };
export { StatusBarStore };
