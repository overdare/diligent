// @summary Rendering helpers for the legacy prompt editor view

import { displayWidth, sliceEndToFitWidth, sliceToFitWidth } from "../framework/string-width";
import { CURSOR_MARKER } from "../framework/types";
import { t } from "../theme";
import { PromptStore } from "./prompt-store";

export function renderPromptEditor(store: PromptStore, width: number, promptText?: string): string[] {
  const sep = `${t.dim}${"─".repeat(Math.max(0, width - 1))}${t.reset}`;
  const prompt = promptText ?? "❯ ";
  const promptPrefix = `${t.bold}${t.dim}${prompt}${t.reset}`;
  const promptWidth = displayWidth(prompt);
  const continuationPrefix = " ".repeat(promptWidth);
  const maxTextWidth = width - promptWidth;

  if (!store.focused) {
    const textLines = store.text.split("\n");
    const renderedLines = textLines.map((line, index) => `${index === 0 ? promptPrefix : continuationPrefix}${line}`);
    return ["", sep, ...renderedLines, sep];
  }

  const before = store.text.slice(0, store.cursorPos);
  const after = store.text.slice(store.cursorPos);
  const hasMultilineInput = store.text.includes("\n");

  if (!hasMultilineInput) {
    let displayBefore = before;
    let displayAfter = after;
    const beforeWidth = displayWidth(before);
    const afterWidth = displayWidth(after);
    if (beforeWidth + afterWidth > maxTextWidth && maxTextWidth > 0) {
      const targetBeforeWidth = Math.floor(maxTextWidth * 0.7);
      displayBefore = beforeWidth > targetBeforeWidth ? sliceEndToFitWidth(before, targetBeforeWidth) : before;
      const remaining = maxTextWidth - displayWidth(displayBefore);
      displayAfter = sliceToFitWidth(after, Math.max(0, remaining));
    }

    const inputLine = `${promptPrefix}${displayBefore}${CURSOR_MARKER}${displayAfter}`;
    const popupLines = renderCompletionPopup(store, width);
    return ["", sep, inputLine, sep, ...popupLines];
  }

  const cursorEmbeddedLines = `${before}${CURSOR_MARKER}${after}`.split("\n");
  const inputLines = cursorEmbeddedLines.map(
    (line, index) => `${index === 0 ? promptPrefix : continuationPrefix}${line}`,
  );
  const popupLines = renderCompletionPopup(store, width);
  return ["", sep, ...inputLines, sep, ...popupLines];
}

function renderCompletionPopup(store: PromptStore, width: number): string[] {
  if (!store.completionVisible || store.completionItems.length === 0) {
    return [];
  }

  const lines: string[] = [];
  const total = store.completionItems.length;
  const visibleCount = Math.min(total, PromptStore.maxVisibleCompletions);
  const start = store.completionScrollOffset;
  const end = start + visibleCount;

  if (start > 0) {
    lines.push(`${t.dim}  ↑ ${start} more${t.reset}`);
  }

  const visibleItems = store.completionItems.slice(start, end);
  const maxNameLen = Math.max(...visibleItems.map((item) => item.name.length));

  for (let i = start; i < end; i++) {
    const item = store.completionItems[i];
    const isSelected = i === store.completionIndex;
    const marker = isSelected ? `${t.accent} ▸ ` : "   ";
    const name = item.name.padEnd(maxNameLen);
    const desc = item.description;
    const descSpace = width - 3 - maxNameLen - 3;
    const truncDesc = descSpace > 4 ? (desc.length > descSpace ? `${desc.slice(0, descSpace - 1)}…` : desc) : "";

    if (isSelected) {
      lines.push(`${marker}${name}${t.reset}   ${t.dim}${truncDesc}${t.reset}`);
    } else {
      lines.push(`${marker}${name}   ${t.dim}${truncDesc}${t.reset}`);
    }
  }

  const remaining = total - end;
  if (remaining > 0) {
    lines.push(`${t.dim}  ↓ ${remaining} more${t.reset}`);
  }

  return lines;
}
