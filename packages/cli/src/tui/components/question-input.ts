// @summary Combined question input — option list where the last row is a free-text field
import { isPrintable, matchesKey } from "../framework/keys";
import type { Component } from "../framework/types";
import { t } from "../theme";

export interface QuestionInputOption {
  label: string;
  description: string;
}

export interface QuestionInputOptions {
  header?: string;
  question: string;
  options?: QuestionInputOption[];
  masked?: boolean;
  placeholder?: string;
}

/**
 * Unified list+input component.
 *
 * With options:
 *   selectedIndex 0..n-1  → option rows (Enter to pick)
 *   selectedIndex n       → inline text-input row (type to fill, Enter to submit)
 *
 *   ◆ [header]  <question>
 *     ▸ label A  · description A
 *       label B  · description B
 *       _              ← cursor row when selected
 *
 * Without options: only the text-input row.
 *
 *   ◆ <question>
 *     › typed value_
 */
export class QuestionInput implements Component {
  // selectedIndex == options.length means "text input row"
  private selectedIndex: number;
  private value = "";
  private cursorPos = 0;
  private readonly opts: QuestionInputOption[];

  constructor(
    private options: QuestionInputOptions,
    private onResult: (value: string | null) => void,
  ) {
    this.opts = options.options ?? [];
    // Start on the first option, or on the input row if there are none
    this.selectedIndex = 0;
  }

  private get onInputRow(): boolean {
    return this.selectedIndex === this.opts.length;
  }

  render(_width: number): string[] {
    const { header, question } = this.options;
    const headerChip = header ? `${t.accent}[${header}]${t.reset} ` : "";
    const headerLine = `  ${t.warn}\u25c6${t.reset} ${headerChip}${t.dim}${question}${t.reset}`;
    const rows: string[] = [];

    // Option rows
    for (let i = 0; i < this.opts.length; i++) {
      const isSelected = i === this.selectedIndex;
      const marker = isSelected ? `${t.accent}\u25b8${t.reset}` : " ";
      const { label, description } = this.opts[i];
      const labelPart = isSelected ? `${t.bold}${label}${t.reset}` : label;
      const descPart = `  ${t.dim}\u00b7 ${description}${t.reset}`;
      rows.push(`    ${marker} ${labelPart}${descPart}`);
    }

    // Text-input row
    const { masked } = this.options;
    const displayValue = masked ? "\u2022".repeat(this.value.length) : this.value;
    const before = displayValue.slice(0, this.cursorPos);
    const cursorChar = displayValue[this.cursorPos] ?? " ";
    const after = displayValue.slice(this.cursorPos + 1);

    const placeholder =
      this.options.placeholder ?? (this.opts.length > 0 ? "or type a custom answer\u2026" : "type your answer\u2026");

    if (this.onInputRow) {
      const field =
        this.value.length === 0
          ? `${t.dim}${placeholder}${t.reset}` // show placeholder when empty
          : `${before}${t.inverse}${cursorChar}${t.reset}${after}`;
      const marker = `${t.accent}\u25b8${t.reset}`;
      rows.push(`    ${marker} ${field}`);
    } else {
      // Not on input row — show typed value dimly, or dim placeholder
      const marker = " ";
      const display =
        displayValue.length > 0 ? `${t.dim}${displayValue}${t.reset}` : `${t.dim}${placeholder}${t.reset}`;
      rows.push(`    ${marker} ${display}`);
    }

    return [headerLine, ...rows];
  }

  handleInput(data: string): void {
    // ↑ / ↓ — navigate rows (works everywhere)
    if (matchesKey(data, "up")) {
      if (this.selectedIndex > 0) this.selectedIndex--;
      return;
    }
    if (matchesKey(data, "down")) {
      if (this.selectedIndex < this.opts.length) this.selectedIndex++;
      return;
    }

    // Cancel
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
      this.onResult(null);
      return;
    }

    // Enter
    if (matchesKey(data, "enter")) {
      if (this.onInputRow) {
        this.onResult(this.value || null);
      } else {
        this.onResult(this.opts[this.selectedIndex].label);
      }
      return;
    }

    // Text editing — only active on input row
    if (!this.onInputRow) {
      // Typing while on an option row → jump to input row and seed the character
      if (isPrintable(data)) {
        this.selectedIndex = this.opts.length;
        this.value = data;
        this.cursorPos = 1;
      }
      return;
    }

    // On input row — full text editing
    if (matchesKey(data, "backspace")) {
      if (this.cursorPos > 0) {
        this.value = this.value.slice(0, this.cursorPos - 1) + this.value.slice(this.cursorPos);
        this.cursorPos--;
      }
      return;
    }
    if (matchesKey(data, "delete")) {
      if (this.cursorPos < this.value.length) {
        this.value = this.value.slice(0, this.cursorPos) + this.value.slice(this.cursorPos + 1);
      }
      return;
    }
    if (matchesKey(data, "left")) {
      if (this.cursorPos > 0) this.cursorPos--;
      return;
    }
    if (matchesKey(data, "right")) {
      if (this.cursorPos < this.value.length) this.cursorPos++;
      return;
    }
    if (matchesKey(data, "ctrl+a")) {
      this.cursorPos = 0;
      return;
    }
    if (matchesKey(data, "ctrl+e")) {
      this.cursorPos = this.value.length;
      return;
    }
    if (matchesKey(data, "ctrl+u")) {
      this.value = "";
      this.cursorPos = 0;
      return;
    }
    if (matchesKey(data, "ctrl+k")) {
      this.value = this.value.slice(0, this.cursorPos);
      return;
    }
    if (isPrintable(data)) {
      this.value = this.value.slice(0, this.cursorPos) + data + this.value.slice(this.cursorPos);
      this.cursorPos++;
    }
  }

  invalidate(): void {}
}
