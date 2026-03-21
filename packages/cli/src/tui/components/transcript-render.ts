// @summary Rendering helpers for transcript store items within the legacy TUI renderer

import { displayWidth, sliceToFitWidth } from "../framework/string-width";
import type { Component, RenderBlock } from "../framework/types";
import { t } from "../theme";
import { MarkdownView } from "./markdown-view";
import { type ThreadItem, type ThreadStore, UserMessageView } from "./thread-store";

function stripAnsi(line: string): string {
  return line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
}

function getCollapsedToolPreviewLines(item: Extract<ThreadItem, { kind: "tool_result" }>): string[] {
  if (item.summaryLine?.trim()) {
    return [item.summaryLine];
  }

  const previewLines: string[] = [];
  for (const line of item.details) {
    const plain = stripAnsi(line).trim();
    if (!plain) continue;
    if (plain.startsWith("└ Found ")) {
      const sanitized = plain.replace(/^└\s*/, "");
      previewLines.push(`⎿  ${sanitized}`);
      break;
    }
  }
  return previewLines;
}

export function renderTranscriptLiveStack(store: ThreadStore, width: number): string[] {
  return renderTranscriptLiveStackBlocks(store, width).flatMap((block) => block.lines);
}

export function renderTranscriptLiveStackBlocks(store: ThreadStore, width: number): RenderBlock[] {
  const { liveStackBlocks } = renderTranscriptSections(store, width, { includeActiveMarkdown: true });
  return liveStackBlocks;
}

export function renderTranscript(store: ThreadStore, width: number): string[] {
  return renderTranscriptLiveStack(store, width);
}

export function renderCommittedTranscriptItems(
  items: ThreadItem[],
  width: number,
  options?: { includeLeadingSeparator?: boolean; toolResultsExpanded?: boolean },
): string[] {
  const lines: string[] = [];
  for (const item of items) {
    const itemLines = renderTranscriptItemLines(item, width, options?.toolResultsExpanded === true);
    if (itemLines.length === 0) {
      continue;
    }
    const shouldSeparate =
      !(item instanceof MarkdownView) && !("kind" in item && item.kind === "assistant_chunk" && item.continued);
    if (shouldSeparate && (lines.length > 0 || options?.includeLeadingSeparator === true)) {
      lines.push("");
    }
    lines.push(...itemLines);
  }
  return lines;
}

function renderAssistantChunkLines(text: string, width: number, continued: boolean): string[] {
  const TURN_MARKER_TEXT = "⏺ ";
  const TURN_MARKER = `${t.text}${TURN_MARKER_TEXT}${t.reset}`;
  const CONTINUATION_PREFIX = "  ";
  const markerPrefixWidth = displayWidth(TURN_MARKER_TEXT);
  const continuationPrefixWidth = displayWidth(CONTINUATION_PREFIX);
  const markdownContentWidth = Math.max(1, width - Math.max(markerPrefixWidth, continuationPrefixWidth));
  const view = MarkdownView.fromText(text);
  const lines = view.render(markdownContentWidth);
  if (lines.length === 0) {
    return [];
  }

  if (continued) {
    return lines.map((line) => `${CONTINUATION_PREFIX}${line}`);
  }

  return [TURN_MARKER + lines[0], ...lines.slice(1).map((line) => `${CONTINUATION_PREFIX}${line}`)];
}

function renderActiveMarkdownLines(activeMarkdown: MarkdownView, width: number): string[] {
  const TURN_MARKER_TEXT = "⏺ ";
  const TURN_MARKER = `${t.text}${TURN_MARKER_TEXT}${t.reset}`;
  const CONTINUATION_PREFIX = "  ";
  const markerPrefixWidth = displayWidth(TURN_MARKER_TEXT);
  const continuationPrefixWidth = displayWidth(CONTINUATION_PREFIX);
  const markdownContentWidth = Math.max(1, width - Math.max(markerPrefixWidth, continuationPrefixWidth));
  const lines = activeMarkdown.render(markdownContentWidth);
  if (lines.length === 0) {
    return [];
  }
  return [TURN_MARKER + lines[0], ...lines.slice(1).map((line) => `${CONTINUATION_PREFIX}${line}`)];
}

function renderTranscriptItemLines(item: ThreadItem, width: number, toolResultsExpanded: boolean): string[] {
  if (item instanceof UserMessageView) {
    return item.render(width);
  }

  if (item.kind === "assistant_chunk") {
    return renderAssistantChunkLines(item.text, width, item.continued);
  }

  if (item.kind === "thinking") {
    return item.bodyLines.length > 0
      ? [item.header, ...item.bodyLines.map((line) => `${t.boldOff}${t.dim}  ${line}${t.reset}`)]
      : [item.header];
  }

  if (item.kind === "tool_result") {
    const hint = toolResultsExpanded
      ? ` ${t.dim}(ctrl+o to collapse)${t.reset}`
      : ` ${t.dim}(ctrl+o to expand)${t.reset}`;
    if (toolResultsExpanded) {
      const childLines: string[] = [];
      if (item.childDetail) {
        if (item.childDetail.status === "loading") {
          childLines.push(`${t.dim}  Loading child thread details…${t.reset}`);
        } else if (item.childDetail.status === "error") {
          childLines.push(
            `${t.error}  Failed to load child thread details: ${item.childDetail.error ?? "unknown error"}${t.reset}`,
          );
        } else if (
          item.childDetail.status === "loaded" &&
          item.childDetail.lines &&
          item.childDetail.lines.length > 0
        ) {
          childLines.push(...item.childDetail.lines);
        }
      }
      return [`${item.header}${hint}`, ...item.details, ...childLines];
    }
    const previewLines = getCollapsedToolPreviewLines(item);
    if (previewLines.length > 0) {
      return [`${item.header}${hint}`, ...previewLines.map((line) => `  ${line}`)];
    }
    return [`${item.header}${hint}`];
  }

  return [...item.lines];
}

export function renderTranscriptSections(
  store: ThreadStore,
  width: number,
  options?: { includeActiveMarkdown?: boolean },
): {
  historyLines: string[];
  liveStackLines: string[];
  liveStackBlocks: RenderBlock[];
  liveStackStatusLines: string[];
  steeringLines: string[];
  activeMarkdown: MarkdownView | null;
  activeQuestion: (Component & { handleInput(data: string): void }) | null;
  separatorEvents: Array<{ reason: string; lineIndex: number }>;
} {
  const historyLines: string[] = [];
  const liveStackLines: string[] = [];
  const liveStackBlocks: RenderBlock[] = [];
  const separatorEvents: Array<{ reason: string; lineIndex: number }> = [];
  const pushSeparator = (target: string[], _reason: string) => {
    if (target.length > 0) {
      target.push("");
    }
  };

  const renderSteeringLines = (): string[] => {
    const pendingSteers = store.getPendingSteers();
    if (pendingSteers.length === 0) return [];
    const prefix = "  ";
    const label = "⚑ ";
    const moreSuffix = " ... (more)";
    const availableWidth = Math.max(0, width - displayWidth(prefix) - displayWidth(label));

    const renderPreview = (message: string): string => {
      const normalized = message.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const firstLine = normalized.split("\n", 1)[0] ?? "";
      const hasMoreLines = normalized.includes("\n");
      const isFirstLineTooWide = displayWidth(firstLine) > availableWidth;

      if (!hasMoreLines && !isFirstLineTooWide) {
        return firstLine;
      }

      if (availableWidth <= 0) {
        return "";
      }

      const suffixWidth = displayWidth(moreSuffix);
      if (suffixWidth >= availableWidth) {
        return sliceToFitWidth(moreSuffix, availableWidth);
      }

      const head = sliceToFitWidth(firstLine, availableWidth - suffixWidth);
      return `${head}${moreSuffix}`;
    };

    return pendingSteers.map((message) => `${t.accent}${prefix}${label}${renderPreview(message)}${t.reset}`);
  };

  for (const item of store.getItems()) {
    if (item instanceof UserMessageView) {
      pushSeparator(historyLines, "item:user");
      historyLines.push(...item.render(width));
      continue;
    }

    if (item.kind === "assistant_chunk") {
      if (!item.continued) {
        pushSeparator(historyLines, "item:assistant_chunk");
      }
      historyLines.push(...renderAssistantChunkLines(item.text, width, item.continued));
      continue;
    }

    if (item.kind === "thinking") {
      pushSeparator(historyLines, "item:thinking");
      historyLines.push(item.header);
      if (item.bodyLines.length > 0) {
        historyLines.push(...item.bodyLines.map((line) => `${t.boldOff}${t.dim}  ${line}${t.reset}`));
      }
      continue;
    }

    if (item.kind === "tool_result") {
      pushSeparator(historyLines, "item:tool_result");
      const hint = store.isToolResultsExpanded()
        ? ` ${t.dim}(ctrl+o to collapse)${t.reset}`
        : ` ${t.dim}(ctrl+o to expand)${t.reset}`;
      historyLines.push(`${item.header}${hint}`);
      if (store.isToolResultsExpanded()) {
        historyLines.push(...item.details);
        if (item.childDetail) {
          if (item.childDetail.status === "loading") {
            historyLines.push(`${t.dim}  Loading child thread details…${t.reset}`);
          } else if (item.childDetail.status === "error") {
            historyLines.push(
              `${t.error}  Failed to load child thread details: ${item.childDetail.error ?? "unknown error"}${t.reset}`,
            );
          } else if (
            item.childDetail.status === "loaded" &&
            item.childDetail.lines &&
            item.childDetail.lines.length > 0
          ) {
            historyLines.push(...item.childDetail.lines);
          }
        }
      } else {
        const previewLines = getCollapsedToolPreviewLines(item);
        if (previewLines.length > 0) {
          historyLines.push(...previewLines.map((line) => `  ${line}`));
        }
      }
    } else {
      pushSeparator(historyLines, "item:plain");
      historyLines.push(...item.lines);
    }
  }

  // Live Stack order is top -> bottom within the bottom pane so only that
  // mutable region needs redraw while committed transcript continues to append.
  const liveStackStatusLines = store.renderLiveStackStatusLines();
  const steeringLines = renderSteeringLines();
  const activeMarkdown = store.getActiveMarkdown();
  const activeQuestion = store.getActiveQuestion();

  if (options?.includeActiveMarkdown !== false && activeMarkdown) {
    const activeLines = renderActiveMarkdownLines(activeMarkdown, width);
    if (activeLines.length > 0) {
      liveStackBlocks.push({ key: "active-markdown", lines: activeLines, persistence: "volatile" });
      liveStackLines.push(...activeLines);
    }
  }
  if (liveStackStatusLines.length > 0) {
    if (liveStackBlocks.length > 0) {
      liveStackBlocks.push({ key: "status-separator", lines: [""], persistence: "volatile" });
      pushSeparator(liveStackLines, "live:status");
    }
    liveStackLines.push(...liveStackStatusLines);
    liveStackBlocks.push({ key: "status", lines: [...liveStackStatusLines], persistence: "volatile" });
    if (store.shouldPadBelowLiveStatusLine()) {
      liveStackLines.push("");
      liveStackBlocks.push({ key: "status-bottom-padding", lines: [""], persistence: "volatile" });
    }
  }
  if (steeringLines.length > 0) {
    liveStackLines.push(...steeringLines);
    liveStackBlocks.push({ key: "steering", lines: [...steeringLines], persistence: "volatile" });
  }
  if (activeQuestion) {
    if (liveStackBlocks.length > 0) {
      pushSeparator(liveStackLines, "live:question");
    }
    const questionLines = activeQuestion.render(width);
    liveStackLines.push(...questionLines);
    if (liveStackBlocks.length > 0) {
      liveStackBlocks.push({ key: "question-separator", lines: [""], persistence: "volatile" });
    }
    liveStackBlocks.push({ key: "question", lines: questionLines, persistence: "volatile" });
  }
  return {
    historyLines,
    liveStackLines,
    liveStackBlocks,
    liveStackStatusLines,
    steeringLines,
    activeMarkdown,
    activeQuestion,
    separatorEvents,
  };
}
