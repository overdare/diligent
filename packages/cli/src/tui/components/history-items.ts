// @summary Convert bounded protocol history into the existing transcript presentation
import type { ThreadItem } from "@diligent/protocol";
import { buildErrorTranscriptLines } from "../error-presentation";
import { t } from "../theme";
import type { ThreadStore } from "./thread-store";
import {
  parseSpawnChildThreadId,
  renderAssistantMessageBlocks,
  renderAssistantStructuredItems,
} from "./thread-store-utils";

export function appendHistoryItems(store: ThreadStore, items: ThreadItem[]): void {
  for (const item of items) {
    switch (item.type) {
      case "error":
        store.addLines(
          buildErrorTranscriptLines(item.error, item.timestamp ?? Date.now(), { includeHint: item === items.at(-1) }),
        );
        break;
      case "compaction":
        store.addLines([`${t.dim}[Compacted: ${item.displaySummary ?? item.summary}]${t.reset}`]);
        break;
      case "contextMessage":
        store.addLines([
          `${t.success}✎ ${item.presentation.title}${t.reset}`,
          ...item.presentation.content.split("\n"),
        ]);
        break;
      case "userMessage": {
        const text =
          typeof item.message.content === "string"
            ? item.message.content
            : item.message.content
                .filter((block) => block.type === "text")
                .map((block) => block.text)
                .join("");
        if (text.trim()) store.addUserMessage(text);
        break;
      }
      case "agentMessage": {
        const { thinking, text } = renderAssistantMessageBlocks(item.message);
        if (thinking.trim()) store.addThinkingMessage(thinking, item.reasoningDurationMs);
        if (text) store.addAssistantMessage(text);
        for (const structured of renderAssistantStructuredItems(item.message)) store.addStructuredItem(structured);
        if (item.usage) store.handleEvent({ type: "usage", usage: item.usage, cost: item.cost ?? 0 });
        break;
      }
      case "toolCall":
        if (typeof item.output === "string") {
          store.addToolResultMessage({
            role: "tool_result",
            toolCallId: item.toolCallId,
            toolName: item.toolName,
            output: item.output,
            outputImages: item.outputImages,
            isError: item.isError ?? false,
            timestamp: item.timestamp ?? Date.now(),
            render: item.render,
          });
          if (item.toolName === "spawn_agent") {
            const childId = parseSpawnChildThreadId(item.output);
            if (childId) store.addLines([`${t.dim}View child history: /older ${childId}${t.reset}`]);
          }
        } else {
          store.addLines([`${t.dim}${item.toolName}: history continues across pages${t.reset}`]);
        }
        break;
      case "collabEvent":
        store.addLines([
          `${t.dim}${item.eventKind}: ${item.nickname ?? item.childThreadId ?? ""}${item.childThreadId ? ` — /older ${item.childThreadId}` : ""}${t.reset}`,
        ]);
        break;
    }
  }
}
