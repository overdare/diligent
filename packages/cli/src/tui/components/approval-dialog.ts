// @summary Inline approval prompt — Once / Always / Reject — minimal 2-line style
import type { ApprovalResponse } from "@diligent/runtime";
import { matchesKey } from "../framework/keys";
import type { Component } from "../framework/types";
import { t } from "../theme";

export interface ApprovalDialogOptions {
  toolName: string;
  permission: "read" | "write" | "execute";
  description: string;
  details?: string;
}

const BUTTONS = [
  { label: "once", key: "o", response: "once" as ApprovalResponse },
  { label: "always", key: "a", response: "always" as ApprovalResponse },
  { label: "reject", key: "r", response: "reject" as ApprovalResponse },
];

/**
 * Minimal inline approval prompt: 2 lines, no borders.
 * Line 1: ◆ tool  details
 * Line 2:   once   always   reject  (selected = inverse)
 * Keys: o/a/r shortcuts, ←/→ navigate, Enter confirm, Esc = reject.
 */
export class ApprovalDialog implements Component {
  private selectedIndex = 0;

  constructor(
    private options: ApprovalDialogOptions,
    private onResult: (response: ApprovalResponse) => void,
  ) {}

  render(_width: number): string[] {
    const { toolName, details, description } = this.options;

    // Line 1: ◆ tool  <details or description>
    const subject = details ?? description;
    const header = `  ${t.warn}\u25c6${t.reset} ${t.bold}${toolName}${t.reset}  ${t.dim}${subject}${t.reset}`;

    // Line 2: choices
    const choices = BUTTONS.map((btn, i) =>
      i === this.selectedIndex ? `${t.inverse} ${btn.label} ${t.reset}` : `${t.dim} ${btn.label} ${t.reset}`,
    ).join("  ");
    const choicesLine = `    ${choices}`;

    return [header, choicesLine];
  }

  handleInput(data: string): void {
    // Single-key shortcuts
    for (const btn of BUTTONS) {
      if (data === btn.key || data === btn.key.toUpperCase()) {
        this.onResult(btn.response);
        return;
      }
    }

    if (matchesKey(data, "left")) {
      this.selectedIndex = (this.selectedIndex - 1 + BUTTONS.length) % BUTTONS.length;
      return;
    }
    if (matchesKey(data, "right") || matchesKey(data, "tab")) {
      this.selectedIndex = (this.selectedIndex + 1) % BUTTONS.length;
      return;
    }

    if (matchesKey(data, "enter")) {
      this.onResult(BUTTONS[this.selectedIndex].response);
      return;
    }

    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onResult("reject");
    }
  }

  invalidate(): void {}
}
