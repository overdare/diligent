// @summary Rendering helpers for the legacy prompt editor view

import { displayWidth } from "../framework/string-width";
import { CURSOR_MARKER } from "../framework/types";
import { t } from "../theme";
import { PromptStore } from "./prompt-store";

export function renderPromptEditor(
  store: PromptStore,
  width: number,
  promptText?: string,
  topSeparatorLine?: string,
  bottomSeparatorLine?: string,
): string[] {
  const editorWidth = Math.max(1, width - 1);
  const sep = `${t.dim}${"─".repeat(Math.max(0, editorWidth))}${t.reset}`;
  const prompt = promptText ?? "❯ ";
  const promptPrefix = `${t.bold}${t.dim}${prompt}${t.reset}`;
  const promptWidth = displayWidth(prompt);
  const continuationPrefix = " ".repeat(promptWidth);
  const maxTextWidth = Math.max(1, editorWidth - promptWidth);

  if (!store.focused) {
    const wrapped = wrapInputTextWithCursor(store.text, maxTextWidth, false);
    const renderedLines = wrapped.map((line, index) => `${index === 0 ? promptPrefix : continuationPrefix}${line}`);
    return [topSeparatorLine ?? sep, ...renderedLines, bottomSeparatorLine ?? sep];
  }

  const before = store.text.slice(0, store.cursorPos);
  const after = store.text.slice(store.cursorPos);
  const cursorEmbeddedText = `${before}${CURSOR_MARKER}${after}`;
  const cursorEmbeddedLines = wrapInputTextWithCursor(cursorEmbeddedText, maxTextWidth, true);
  const inputLines = cursorEmbeddedLines.map(
    (line, index) => `${index === 0 ? promptPrefix : continuationPrefix}${line}`,
  );
  const popupLines = renderCompletionPopup(store, editorWidth);
  return [topSeparatorLine ?? sep, ...inputLines, bottomSeparatorLine ?? sep, ...popupLines];
}

function wrapInputTextWithCursor(text: string, maxTextWidth: number, includesCursorMarker: boolean): string[] {
  const source = includesCursorMarker ? text : `${text}${CURSOR_MARKER}`;
  const logicalLines = source.split("\n");
  const wrapped: string[] = [];
  for (const line of logicalLines) {
    wrapped.push(...wrapLogicalLine(line, maxTextWidth));
  }
  if (!includesCursorMarker && wrapped.length > 0) {
    const lastIndex = wrapped.length - 1;
    wrapped[lastIndex] = wrapped[lastIndex].replace(CURSOR_MARKER, "");
  }
  return wrapped.length > 0 ? wrapped : [includesCursorMarker ? CURSOR_MARKER : ""];
}

function wrapLogicalLine(line: string, maxTextWidth: number): string[] {
  if (line.length === 0) return [""];
  const segments: string[] = [];
  let current = "";
  let currentWidth = 0;

  for (let i = 0; i < line.length; ) {
    if (line.startsWith(CURSOR_MARKER, i)) {
      current += CURSOR_MARKER;
      i += CURSOR_MARKER.length;
      continue;
    }

    const codePoint = line.codePointAt(i);
    if (codePoint === undefined) break;
    const ch = String.fromCodePoint(codePoint);
    const chWidth = Math.max(0, displayWidth(ch));
    const nextWidth = currentWidth + chWidth;

    if (nextWidth > maxTextWidth && currentWidth > 0) {
      segments.push(current);
      current = ch;
      currentWidth = chWidth;
    } else {
      current += ch;
      currentWidth = nextWidth;
    }

    i += ch.length;
  }

  segments.push(current);
  return segments;
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
