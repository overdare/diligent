// @summary Footer status bar displaying mode and connection information

import type { Component } from "../framework/types";
import { renderStatusBar } from "./status-bar-render";
import { type StatusBarInfo, StatusBarStore } from "./status-bar-store";

/** Bottom status bar showing model, tokens, session info */
export class StatusBar implements Component {
  private store = new StatusBarStore();

  update(info: Partial<StatusBarInfo>): void {
    this.store.update(info);
  }

  resetUsage(): void {
    this.store.resetUsage();
  }

  render(width: number): string[] {
    return renderStatusBar(this.store, width);
  }

  invalidate(): void {}
}

export type { StatusBarInfo };
export { StatusBarStore };
