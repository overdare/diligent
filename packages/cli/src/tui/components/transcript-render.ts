// @summary Rendering helpers for transcript store items within the legacy TUI renderer

import { debugLogger } from "../framework/debug-logger";
import { displayWidth, sliceToFitWidth } from "../framework/string-width";
import { t } from "../theme";
import { MarkdownView } from "./markdown-view";
import { type TranscriptStore, UserMessageView } from "./transcript-store";

export function getCommittedTranscriptLineCount(store: TranscriptStore, width: number): number {
  let count = 0;
  const items = store.getItems();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (i > 0 && count > 0) count++;

    if (!(item instanceof MarkdownView) && !(item instanceof UserMessageView) && item.kind === "tool_result") {
      return count;
    }

    if (item instanceof MarkdownView) {
      const markerPrefixWidth = displayWidth("⏺ ");
      const continuationPrefixWidth = displayWidth("  ");
      const markdownContentWidth = Math.max(1, width - Math.max(markerPrefixWidth, continuationPrefixWidth));
      count += item.render(markdownContentWidth).length;
    } else if (item instanceof UserMessageView) {
      count += item.render(width).length;
    } else if (item.kind === "thinking") {
      count += 1 + item.bodyLines.length;
    } else {
      count += item.lines.length;
    }
  }
  return count;
}

export function renderTranscript(store: TranscriptStore, width: number): string[] {
  const result: string[] = [];
  const traceEnabled = debugLogger.isEnabled;
  const separatorEvents: Array<{ reason: string; lineIndex: number }> = [];
  const pushSeparator = (reason: string) => {
    if (result.length > 0) {
      result.push("");
      if (traceEnabled) {
        separatorEvents.push({ reason, lineIndex: result.length - 1 });
      }
    }
  };

  const TURN_MARKER_TEXT = "⏺ ";
  const TURN_MARKER = `${t.text}${TURN_MARKER_TEXT}${t.reset}`;
  const CONTINUATION_PREFIX = "  ";
  const markerPrefixWidth = displayWidth(TURN_MARKER_TEXT);
  const continuationPrefixWidth = displayWidth(CONTINUATION_PREFIX);
  const markdownContentWidth = Math.max(1, width - Math.max(markerPrefixWidth, continuationPrefixWidth));
  const renderSteeringLines = (): string[] => {
    const pendingSteers = store.getPendingSteers();
    if (pendingSteers.length === 0) return [];
    const prefix = "⚑ steering ";
    const availableWidth = Math.max(0, width - displayWidth(prefix) - 2);
    return pendingSteers.map((message) => {
      const clipped = availableWidth > 0 ? sliceToFitWidth(message, availableWidth) : "";
      const text = clipped.length < message.length ? `${clipped.slice(0, Math.max(0, clipped.length - 1))}…` : clipped;
      return `${t.accent}  ${prefix}${text}${t.reset}`;
    });
  };

  for (const item of store.getItems()) {
    if (item instanceof MarkdownView) {
      pushSeparator("item:markdown");
      const lines = item.render(markdownContentWidth);
      if (lines.length > 0) {
        result.push(TURN_MARKER + lines[0], ...lines.slice(1).map((line) => `${CONTINUATION_PREFIX}${line}`));
      }
      continue;
    }

    if (item instanceof UserMessageView) {
      pushSeparator("item:user");
      result.push(...item.render(width));
      continue;
    }

    if (item.kind === "thinking") {
      pushSeparator("item:thinking");
      result.push(item.header);
      if (item.bodyLines.length > 0) {
        result.push(...item.bodyLines.map((line) => `${t.boldOff}${t.dim}  ${line}${t.reset}`));
      }
      continue;
    }

    if (item.kind === "tool_result") {
      pushSeparator("item:tool_result");
      const hint = store.isToolResultsExpanded()
        ? ` ${t.dim}(ctrl+o to collapse)${t.reset}`
        : ` ${t.dim}(ctrl+o to expand)${t.reset}`;
      result.push(`${item.header}${hint}`);
      if (store.isToolResultsExpanded()) {
        result.push(...item.details);
      }
    } else {
      pushSeparator("item:plain");
      result.push(...item.lines);
    }
  }

  // Live Stack priority (low -> high). Since the renderer clips from the end
  // when the terminal is small, higher-priority blocks stay closer to input.
  const liveStackStatusLine = store.renderLiveStackStatusLine();
  const steeringLines = renderSteeringLines();
  const activeMarkdown = store.getActiveMarkdown();
  const activeQuestion = store.getActiveQuestion();

  if (liveStackStatusLine) {
    pushSeparator("live:status");
    result.push(liveStackStatusLine);
  }
  if (steeringLines.length > 0) {
    pushSeparator("live:steering");
    result.push(...steeringLines);
  }
  if (activeMarkdown) {
    const lines = activeMarkdown.render(markdownContentWidth);
    if (lines.length > 0) {
      pushSeparator("live:markdown");
      result.push(TURN_MARKER + lines[0], ...lines.slice(1).map((line) => `${CONTINUATION_PREFIX}${line}`));
    }
  }
  if (activeQuestion) {
    pushSeparator("live:question");
    result.push(...activeQuestion.render(width));
  }

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
