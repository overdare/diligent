// @summary Renderer-agnostic prompt editor state for text, history, completion, paste abstraction, and busy state

import type { CompletionItem } from "../commands/registry";
import type { InputHistory } from "../input-history";

const MAX_HISTORY_SIZE = 100;
const MAX_VISIBLE_COMPLETIONS = 8;
const SPINNER_FRAMES = ["✶", "✳", "✢"];
const PASTE_PLACEHOLDER_MIN_CHARS = 80;

export interface PromptStoreOptions {
  history?: InputHistory;
}

export class PromptStore {
  focused = false;
  busy = false;
  spinnerIndex = 0;
  text = "";
  cursorPos = 0;
  history: string[] = [];
  historyIndex = -1;
  historyDraft = "";
  completionItems: CompletionItem[] = [];
  completionIndex = 0;
  completionVisible = false;
  completionScrollOffset = 0;
  pasteCount = 0;
  pastedBlocks = new Map<string, string>();
  private persistentHistory?: InputHistory;

  constructor(options: PromptStoreOptions) {
    if (options.history) {
      this.persistentHistory = options.history;
      this.history = options.history.getEntries();
    }
  }

  static get spinnerFrames(): string[] {
    return SPINNER_FRAMES;
  }

  static get maxVisibleCompletions(): number {
    return MAX_VISIBLE_COMPLETIONS;
  }

  static get pastePlaceholderMinChars(): number {
    return PASTE_PLACEHOLDER_MIN_CHARS;
  }

  reloadHistory(): void {
    if (this.persistentHistory) {
      this.history = this.persistentHistory.getEntries();
    }
  }

  clear(): void {
    this.text = "";
    this.cursorPos = 0;
    this.pastedBlocks.clear();
  }

  setText(text: string): void {
    this.text = text;
    this.cursorPos = text.length;
    this.pastedBlocks.clear();
  }

  getText(): string {
    return this.text;
  }

  recordSubmittedText(text: string): void {
    this.addToHistory(text);
    this.text = "";
    this.cursorPos = 0;
    this.historyIndex = -1;
    this.pastedBlocks.clear();
  }

  expandPastedTokens(text: string): string {
    let result = text;
    for (const [token, content] of this.pastedBlocks.entries()) {
      result = result.split(token).join(content);
    }
    return result;
  }

  addToHistory(text: string): void {
    if (this.history.length > 0 && this.history[this.history.length - 1] === text) {
      return;
    }
    this.history.push(text);
    if (this.history.length > MAX_HISTORY_SIZE) {
      this.history.shift();
    }
    this.persistentHistory?.add(text);
  }

  commonPrefix(strings: string[]): string {
    if (strings.length === 0) return "";
    let prefix = strings[0];
    for (let i = 1; i < strings.length; i++) {
      while (!strings[i].startsWith(prefix)) {
        prefix = prefix.slice(0, -1);
        if (prefix === "") return "";
      }
    }
    return prefix;
  }

  shouldHandleNavigation(): boolean {
    if (this.text === "") return true;
    if (this.historyIndex !== -1) {
      return this.cursorPos === 0 || this.cursorPos === this.text.length;
    }
    return false;
  }

  navigateHistory(direction: number): void {
    if (this.history.length === 0) return;

    if (this.historyIndex === -1) {
      this.historyDraft = this.text;
    }

    const newIndex = this.historyIndex + direction;
    if (newIndex >= this.history.length) return;

    if (newIndex < 0) {
      this.historyIndex = -1;
      this.text = this.historyDraft;
      this.cursorPos = this.text.length;
      return;
    }

    this.historyIndex = newIndex;
    const histIdx = this.history.length - 1 - newIndex;
    this.text = this.history[histIdx];
    this.cursorPos = this.text.length;
  }

  updateCompletion(onCompleteDetailed?: (partial: string) => CompletionItem[]): void {
    if (
      this.text.startsWith("/") &&
      !this.text.startsWith("//") &&
      !this.text.includes(" ") &&
      !this.text.includes("\n") &&
      onCompleteDetailed
    ) {
      const partial = this.text.slice(1);
      this.completionItems = onCompleteDetailed(partial);
      this.completionVisible = this.completionItems.length > 0;
      this.completionIndex = 0;
      this.completionScrollOffset = 0;
    } else {
      this.completionVisible = false;
      this.completionItems = [];
    }
  }

  scrollCompletionIntoView(): void {
    if (this.completionIndex < this.completionScrollOffset) {
      this.completionScrollOffset = this.completionIndex;
    } else if (this.completionIndex >= this.completionScrollOffset + MAX_VISIBLE_COMPLETIONS) {
      this.completionScrollOffset = this.completionIndex - MAX_VISIBLE_COMPLETIONS + 1;
    }
  }

  makePasteToken(index: number, extraLines: number): string {
    const lineLabel = extraLines === 1 ? "line" : "lines";
    return `[Pasted text #${index} +${extraLines} ${lineLabel}]`;
  }
}
