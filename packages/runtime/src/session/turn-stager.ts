// @summary Turn staging helper for session runs with compaction-aware pending entries

import type { CoreAgentEvent } from "@diligent/core/agent";
import { buildMessagesFromCompaction, selectForCompaction } from "@diligent/core/agent";
import type { Message } from "@diligent/core/types";
import type { CompactionEntry, SessionEntry } from "./types";
import { generateEntryId } from "./types";

export interface TurnStagerSnapshot {
  entries: SessionEntry[];
  leafId: string | null;
}

export class TurnStager {
  private stagedEntries: SessionEntry[] = [];
  private stagedLeafId: string | null;
  private stagedConversation: Message[];

  constructor(baseLeafId: string | null, baseConversation: Message[], userMessage: Message) {
    this.stagedLeafId = baseLeafId;
    this.stagedConversation = [...baseConversation];
    this.stageMessage(userMessage);
  }

  handleEvent(event: CoreAgentEvent, keepRecentTokens: number): void {
    if (event.type === "turn_end") {
      this.stageMessage(event.message);
      for (const toolResult of event.toolResults) {
        this.stageMessage(toolResult);
      }
      return;
    }

    if (event.type === "steering_injected") {
      for (const msg of event.messages) {
        this.stageMessage(msg);
      }
      return;
    }

    if (event.type === "compaction_end") {
      const recentUserMessages = selectForCompaction(this.stagedConversation, keepRecentTokens).recentUserMessages;
      this.stagedConversation = buildMessagesFromCompaction(recentUserMessages, event.summary, Date.now());
      this.stageCompaction({
        summary: event.summary,
        recentUserMessages,
        tokensBefore: event.tokensBefore,
        tokensAfter: event.tokensAfter,
      });
    }
  }

  getSnapshot(): TurnStagerSnapshot {
    return {
      entries: [...this.stagedEntries],
      leafId: this.stagedLeafId,
    };
  }

  private stageMessage(message: Message): void {
    this.stagedConversation.push(message);
    this.stageEntry({
      type: "message",
      id: generateEntryId(),
      parentId: this.stagedLeafId,
      timestamp: new Date().toISOString(),
      message,
    });
  }

  private stageCompaction(event: {
    summary: string;
    recentUserMessages: Message[];
    tokensBefore: number;
    tokensAfter: number;
  }): void {
    const entry: CompactionEntry = {
      type: "compaction",
      id: generateEntryId(),
      parentId: this.stagedLeafId,
      timestamp: new Date().toISOString(),
      summary: event.summary,
      recentUserMessages: event.recentUserMessages,
      tokensBefore: event.tokensBefore,
      tokensAfter: event.tokensAfter,
    };
    this.stageEntry(entry);
  }

  private stageEntry(entry: SessionEntry): void {
    this.stagedEntries.push(entry);
    this.stagedLeafId = entry.id;
  }
}
