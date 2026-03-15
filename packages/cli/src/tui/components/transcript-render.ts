// @summary Rendering helpers for transcript store items within the legacy TUI renderer

import { debugLogger } from "../framework/debug-logger";
import { displayWidth, sliceToFitWidth } from "../framework/string-width";
import type { Component, RenderBlock } from "../framework/types";
import { t } from "../theme";
import { MarkdownView } from "./markdown-view";
import { type TranscriptItem, type TranscriptStore, UserMessageView } from "./transcript-store";

function getCollapsedToolPreviewLines(details: string[]): string[] {
  const previewLines: string[] = [];
  for (const line of details) {
    const plain = line
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
      .trim();
    if (!plain) continue;
    if (plain.startsWith("└ Found ")) {
      const sanitized = plain.replace(/^└\s*/, "");
      previewLines.push(sanitized);
      break;
    }
  }
  return previewLines;
}

export function renderTranscriptLiveStack(store: TranscriptStore, width: number): string[] {
  return renderTranscriptLiveStackBlocks(store, width).flatMap((block) => block.lines);
}

export function renderTranscriptLiveStackBlocks(store: TranscriptStore, width: number): RenderBlock[] {
  const { liveStackBlocks } = renderTranscriptSections(store, width, { includeActiveMarkdown: false });
  return liveStackBlocks;
}

export function renderTranscript(store: TranscriptStore, width: number): string[] {
  const liveStackLines = renderTranscriptLiveStack(store, width);
  const { liveStackStatusLine, steeringLines, activeMarkdown, activeQuestion, separatorEvents } =
    renderTranscriptSections(store, width, { includeActiveMarkdown: false });
  const traceEnabled = debugLogger.isEnabled;
  const result = [...liveStackLines];

  if (traceEnabled) {
    const blankLineIndexes: number[] = [];
    const blankRuns: Array<{ start: number; length: number }> = [];
    let runStart = -1;
    let runLength = 0;

    for (let index = 0; index < result.length; index++) {
      if (result[index] === "") {
        blankLineIndexes.push(index);
        if (runStart === -1) {
          runStart = index;
          runLength = 1;
        } else {
          runLength++;
        }
      } else if (runStart !== -1) {
        blankRuns.push({ start: runStart, length: runLength });
        runStart = -1;
        runLength = 0;
      }
    }

    if (runStart !== -1) {
      blankRuns.push({ start: runStart, length: runLength });
    }

    const itemKinds = store
      .getItems()
      .slice(Math.max(0, store.getItems().length - 20))
      .map((item) => {
        if (item instanceof MarkdownView) return "markdown";
        if (item instanceof UserMessageView) return "user";
        return item.kind;
      });

    debugLogger.logAgentEvent({
      type: "chat_render_trace",
      width,
      totalLines: result.length,
      historyLineCount: 0,
      liveStackLineCount: liveStackLines.length,
      blankLines: blankLineIndexes.length,
      blankLineIndexes: blankLineIndexes.slice(0, 80),
      blankRuns: blankRuns.slice(0, 40),
      separatorEvents: separatorEvents.slice(0, 80),
      itemCount: store.getItems().length,
      itemKinds,
      hasLiveStackStatus: liveStackStatusLine !== null,
      hasSteering: steeringLines.length > 0,
      hasActiveMarkdown: activeMarkdown !== null,
      hasActiveQuestion: activeQuestion !== null,
    });
  }

  return result;
}

export function renderCommittedTranscriptItems(
  items: TranscriptItem[],
  width: number,
  options?: { includeLeadingSeparator?: boolean; toolResultsExpanded?: boolean },
): string[] {
  const lines: string[] = [];
  for (const item of items) {
    const itemLines = renderTranscriptItemLines(item, width, options?.toolResultsExpanded === true);
    if (itemLines.length === 0) {
      continue;
    }
    const shouldSeparate = !(item instanceof MarkdownView);
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

function renderTranscriptItemLines(item: TranscriptItem, width: number, toolResultsExpanded: boolean): string[] {
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
      return [`${item.header}${hint}`, ...item.details];
    }
    const previewLines = getCollapsedToolPreviewLines(item.details);
    if (previewLines.length > 0) {
      const previewWithArrow = previewLines.map((line, index) => {
        if (index !== 0) return line;
        const trimmed = line.trim();
        return `  ⎿  ${trimmed}`;
      });
      return [`${item.header}${hint}`, ...previewWithArrow];
    }
    return [`${item.header}${hint}`];
  }

  return [...item.lines];
}

export function renderTranscriptSections(
  store: TranscriptStore,
  width: number,
  options?: { includeActiveMarkdown?: boolean },
): {
  historyLines: string[];
  liveStackLines: string[];
  liveStackBlocks: RenderBlock[];
  liveStackStatusLine: string | null;
  steeringLines: string[];
  activeMarkdown: MarkdownView | null;
  activeQuestion: (Component & { handleInput(data: string): void }) | null;
  separatorEvents: Array<{ reason: string; lineIndex: number }>;
} {
  const historyLines: string[] = [];
  const liveStackLines: string[] = [];
  const liveStackBlocks: RenderBlock[] = [];
  const traceEnabled = debugLogger.isEnabled;
  const separatorEvents: Array<{ reason: string; lineIndex: number }> = [];
  const pushSeparator = (target: string[], reason: string) => {
    if (target.length > 0) {
      target.push("");
      if (traceEnabled) {
        separatorEvents.push({ reason, lineIndex: target.length - 1 });
      }
    }
  };

  const renderSteeringLines = (): string[] => {
    const pendingSteers = store.getPendingSteers();
    if (pendingSteers.length === 0) return [];
    const prefix = "  ";
    const label = "⚑ ";
    const availableWidth = Math.max(0, width - displayWidth(prefix) - displayWidth(label));
    return pendingSteers.map((message) => {
      const clipped = availableWidth > 0 ? sliceToFitWidth(message, availableWidth) : "";
      const text = clipped.length < message.length ? `${clipped.slice(0, Math.max(0, clipped.length - 1))}…` : clipped;
      return `${t.accent}${prefix}${label}${text}${t.reset}`;
    });
  };

  for (const item of store.getItems()) {
    if (item instanceof UserMessageView) {
      pushSeparator(historyLines, "item:user");
      historyLines.push(...item.render(width));
      continue;
    }

    if (item.kind === "assistant_chunk") {
      pushSeparator(historyLines, "item:assistant_chunk");
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
      } else {
        const previewLines = getCollapsedToolPreviewLines(item.details);
        if (previewLines.length > 0) {
          const previewWithArrow = previewLines.map((line, index) => {
            if (index !== 0) return line;
            const trimmed = line.trim();
            return `  ⎿  ${trimmed}`;
          });
          historyLines.push(...previewWithArrow);
        }
      }
    } else {
      pushSeparator(historyLines, "item:plain");
      historyLines.push(...item.lines);
    }
  }

  // Live Stack order is top -> bottom within the bottom pane so only that
  // mutable region needs redraw while committed transcript continues to append.
  const liveStackStatusLine = store.renderLiveStackStatusLine();
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
  if (liveStackStatusLine) {
    if (liveStackBlocks.length > 0) {
      liveStackBlocks.push({ key: "status-separator", lines: [""], persistence: "volatile" });
      pushSeparator(liveStackLines, "live:status");
    }
    liveStackLines.push(liveStackStatusLine);
    liveStackBlocks.push({ key: "status", lines: [liveStackStatusLine], persistence: "volatile" });
  }
  if (steeringLines.length > 0) {
    if (liveStackBlocks.length > 0) {
      pushSeparator(liveStackLines, "live:steering");
      liveStackBlocks.push({ key: "steering-separator", lines: [""], persistence: "volatile" });
    }
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
    liveStackStatusLine,
    steeringLines,
    activeMarkdown,
    activeQuestion,
    separatorEvents,
  };
}
