// @summary Multi-line command input editor with command completion support
import type { CompletionItem } from "../commands/registry";
import type { Component, Focusable } from "../framework/types";
import type { InputHistory } from "../input-history";
import { handlePromptInput } from "./prompt-keymap";
import { renderPromptEditor } from "./prompt-render";
import { PromptStore } from "./prompt-store";

const SPINNER_INTERVAL = 120;

export interface InputEditorOptions {
  prompt?: string;
  onSubmit?: (text: string) => void;
  onCancel?: () => void;
  onExit?: () => void;
  onComplete?: (partial: string) => string[];
  onCompleteDetailed?: (partial: string) => CompletionItem[];
  history?: InputHistory;
}

export class InputEditor implements Component, Focusable {
  private spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private store: PromptStore;

  constructor(
    private options: InputEditorOptions,
    private requestRender: () => void,
  ) {
    this.store = new PromptStore({ history: options.history });
  }

  get focused(): boolean {
    return this.store.focused;
  }

  set focused(value: boolean) {
    this.store.focused = value;
  }

  get busy(): boolean {
    return this.store.busy;
  }

  setBusy(val: boolean): void {
    if (this.store.busy === val) return;
    this.store.busy = val;
    if (val) {
      this.store.spinnerIndex = 0;
      this.spinnerTimer = setInterval(() => {
        this.store.spinnerIndex = (this.store.spinnerIndex + 1) % PromptStore.spinnerFrames.length;
        this.requestRender();
      }, SPINNER_INTERVAL);
    } else if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    this.requestRender();
  }

  reloadHistory(): void {
    this.store.reloadHistory();
  }

  render(width: number): string[] {
    return renderPromptEditor(this.store, width, this.options.prompt);
  }

  handleInput(data: string): boolean {
    return handlePromptInput(this.store, data, {
      onSubmit: this.options.onSubmit,
      onCancel: this.options.onCancel,
      onExit: this.options.onExit,
      onComplete: this.options.onComplete,
      onCompleteDetailed: this.options.onCompleteDetailed,
      requestRender: this.requestRender,
    });
  }

  invalidate(): void {}

  clear(): void {
    this.store.clear();
    this.requestRender();
  }

  setText(text: string): void {
    this.store.setText(text);
    this.store.updateCompletion(this.options.onCompleteDetailed);
  }

  getText(): string {
    return this.store.getText();
  }
}
