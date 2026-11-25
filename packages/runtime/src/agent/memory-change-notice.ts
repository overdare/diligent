// @summary One-time reminder that project memory changed since a running thread's previous turn

import type { AgentLoopHook } from "@diligent/core/agent";

const NOTICE =
  "Project memory changed since your previous turn, possibly by another agent or harness. Memory files and documents you read earlier in this conversation may be outdated; read them again before relying on them. The current memory section follows.";

export interface MemoryChangeNotice extends AgentLoopHook {
  /** Queue a notice carrying the new memory section, or an empty-index note when memory was removed. */
  notify(section: string | undefined): void;
}

export function createMemoryChangeNotice(): MemoryChangeNotice {
  let pending: string | undefined;
  return {
    id: "memory-change-notice",
    notify(section) {
      pending = section ?? "The project memory index is now empty.";
    },
    restore() {
      pending = undefined;
    },
    beforeTurn() {
      if (pending === undefined) return;
      const section = pending;
      pending = undefined;
      return [
        {
          source: "memory-change-notice",
          content: ["<system-reminder>", NOTICE, "", section, "</system-reminder>"].join("\n"),
        },
      ];
    },
  };
}
