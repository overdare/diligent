// @summary Prompt editor key handling detached from rendering

import type { CompletionItem } from "../commands/registry";
import { isPrintable, matchesKey } from "../framework/keys";
import { BRACKETED_PASTE_END, BRACKETED_PASTE_START } from "../framework/stdin-buffer";
import { PromptStore } from "./prompt-store";

export interface PromptKeymapOptions {
  onSubmit?: (text: string) => void;
  onCancel?: () => void;
  onExit?: () => void;
  onComplete?: (partial: string) => string[];
  onCompleteDetailed?: (partial: string) => CompletionItem[];
  requestRender: () => void;
}

export function handlePromptInput(store: PromptStore, data: string, options: PromptKeymapOptions): boolean {
  const isBracketedPaste = matchesKey(data, "bracketed_paste");

  if (matchesKey(data, "escape")) {
    if (store.completionVisible) {
      store.completionVisible = false;
      store.completionItems = [];
      options.requestRender();
      return true;
    }
    return false;
  }

  if (matchesKey(data, "shift+enter")) {
    store.text = `${store.text.slice(0, store.cursorPos)}\n${store.text.slice(store.cursorPos)}`;
    store.cursorPos += 1;
    store.updateCompletion(options.onCompleteDetailed);
    options.requestRender();
    return true;
  }

  if (matchesKey(data, "enter")) {
    if (store.completionVisible && store.completionItems.length > 0) {
      const selected = store.completionItems[store.completionIndex];
      const submitText = `/${selected.name}`;
      store.completionVisible = false;
      store.completionItems = [];
      store.recordSubmittedText(submitText);
      options.requestRender();
      options.onSubmit?.(submitText);
      return true;
    }
    const text = store.expandPastedTokens(store.text).trim();
    if (text) {
      store.recordSubmittedText(text);
      options.requestRender();
      options.onSubmit?.(text);
    }
    return true;
  }

  if (matchesKey(data, "ctrl+c")) {
    options.onCancel?.();
    return true;
  }

  if (matchesKey(data, "ctrl+d")) {
    if (store.text.length === 0) {
      options.onExit?.();
    }
    return true;
  }

  if (matchesKey(data, "ctrl+a") || matchesKey(data, "home")) {
    store.cursorPos = 0;
    options.requestRender();
    return true;
  }

  if (matchesKey(data, "ctrl+e") || matchesKey(data, "end")) {
    store.cursorPos = store.text.length;
    options.requestRender();
    return true;
  }

  if (matchesKey(data, "ctrl+k")) {
    store.text = store.text.slice(0, store.cursorPos);
    store.updateCompletion(options.onCompleteDetailed);
    options.requestRender();
    return true;
  }

  if (matchesKey(data, "ctrl+u")) {
    store.text = store.text.slice(store.cursorPos);
    store.cursorPos = 0;
    store.updateCompletion(options.onCompleteDetailed);
    options.requestRender();
    return true;
  }

  if (matchesKey(data, "ctrl+w")) {
    const before = store.text.slice(0, store.cursorPos);
    const trimmed = before.replace(/\s+$/, "");
    const lastSpace = trimmed.lastIndexOf(" ");
    const newPos = lastSpace === -1 ? 0 : lastSpace + 1;
    store.text = store.text.slice(0, newPos) + store.text.slice(store.cursorPos);
    store.cursorPos = newPos;
    store.updateCompletion(options.onCompleteDetailed);
    options.requestRender();
    return true;
  }

  if (matchesKey(data, "backspace")) {
    if (store.cursorPos > 0) {
      store.text = store.text.slice(0, store.cursorPos - 1) + store.text.slice(store.cursorPos);
      store.cursorPos--;
      store.updateCompletion(options.onCompleteDetailed);
      options.requestRender();
    }
    return true;
  }

  if (matchesKey(data, "delete")) {
    if (store.cursorPos < store.text.length) {
      store.text = store.text.slice(0, store.cursorPos) + store.text.slice(store.cursorPos + 1);
      store.updateCompletion(options.onCompleteDetailed);
      options.requestRender();
    }
    return true;
  }

  if (matchesKey(data, "left")) {
    if (store.cursorPos > 0) {
      store.cursorPos--;
      options.requestRender();
    }
    return true;
  }

  if (matchesKey(data, "right")) {
    if (store.cursorPos < store.text.length) {
      store.cursorPos++;
      options.requestRender();
    }
    return true;
  }

  if (matchesKey(data, "up")) {
    if (store.completionVisible) {
      store.completionIndex = Math.max(0, store.completionIndex - 1);
      store.scrollCompletionIntoView();
      options.requestRender();
      return true;
    }
    if (!store.shouldHandleNavigation()) return false;
    store.navigateHistory(1);
    options.requestRender();
    return true;
  }

  if (matchesKey(data, "down")) {
    if (store.completionVisible) {
      store.completionIndex = Math.min(store.completionItems.length - 1, store.completionIndex + 1);
      store.scrollCompletionIntoView();
      options.requestRender();
      return true;
    }
    if (!store.shouldHandleNavigation()) return false;
    store.navigateHistory(-1);
    options.requestRender();
    return true;
  }

  if (matchesKey(data, "tab")) {
    if (store.completionVisible && store.completionItems.length > 0) {
      const selected = store.completionItems[store.completionIndex];
      store.text = `/${selected.name} `;
      store.cursorPos = store.text.length;
      store.updateCompletion(options.onCompleteDetailed);
      options.requestRender();
      return true;
    }
    if (store.text.startsWith("/") && !store.text.startsWith("//") && options.onComplete) {
      const partial = store.text.slice(1).split(" ")[0];
      if (!store.text.includes(" ")) {
        const candidates = options.onComplete(partial);
        if (candidates.length === 1) {
          store.text = `/${candidates[0]} `;
          store.cursorPos = store.text.length;
        } else if (candidates.length > 1) {
          const common = store.commonPrefix(candidates);
          if (common.length > partial.length) {
            store.text = `/${common}`;
            store.cursorPos = store.text.length;
          }
        }
        options.requestRender();
      }
    }
    return true;
  }

  if (isBracketedPaste) {
    const pasted = data.slice(BRACKETED_PASTE_START.length, data.length - BRACKETED_PASTE_END.length);
    if (pasted.length > 0) {
      const extraLines = pasted.match(/\r\n|\r|\n/g)?.length ?? 0;
      const shouldUsePlaceholder = extraLines > 0 || pasted.length >= PromptStore.pastePlaceholderMinChars;

      if (shouldUsePlaceholder) {
        store.pasteCount += 1;
        const token = store.makePasteToken(store.pasteCount, extraLines);
        store.pastedBlocks.set(token, pasted);
        store.text = store.text.slice(0, store.cursorPos) + token + store.text.slice(store.cursorPos);
        store.cursorPos += token.length;
      } else {
        store.text = store.text.slice(0, store.cursorPos) + pasted + store.text.slice(store.cursorPos);
        store.cursorPos += pasted.length;
      }

      store.updateCompletion(options.onCompleteDetailed);
      options.requestRender();
    }
    return true;
  }

  if (isPrintable(data)) {
    store.text = store.text.slice(0, store.cursorPos) + data + store.text.slice(store.cursorPos);
    store.cursorPos += data.length;
    store.updateCompletion(options.onCompleteDetailed);
    options.requestRender();
    return true;
  }

  return false;
}
