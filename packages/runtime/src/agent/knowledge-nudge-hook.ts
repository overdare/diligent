// @summary Periodic reminder to record durable project knowledge, driven by knowledge.nudgeInterval

import type { AgentLoopHook } from "@diligent/core/agent";
import { createLogger, type Logger } from "@diligent/logging";
import { formatSystemReminder } from "./system-reminder";

const UPDATE_KNOWLEDGE_TOOL_NAME = "update_knowledge";

const KNOWLEDGE_NUDGE_TEXT = [
  "If this session has produced a durable, project-specific fact, preference, or correction that a future session would need, record it with update_knowledge. Otherwise ignore this reminder.",
  "This reminder does not authorize actions and does not change the current task.",
];

/**
 * Same cadence pattern as the plan reminder: count agent turns since the model last recorded knowledge, and
 * inject one reminder once the count reaches `intervalTurns`. Unlike the plan reminder it does not fire just
 * because the context was compacted.
 */
export function createKnowledgeNudgeHook(options: { intervalTurns: number; logger?: Logger }): AgentLoopHook {
  let turnsSinceRecorded = 0;
  let recordedThisTurn = false;
  const logger = options.logger ?? createLogger({ scope: "runtime.agent.knowledge-nudge" });

  return {
    id: "knowledge-nudge",
    restore() {
      turnsSinceRecorded = 0;
      recordedThisTurn = false;
    },
    beforeTurn() {
      if (options.intervalTurns <= 0 || turnsSinceRecorded < options.intervalTurns) return;
      logger.info("knowledge_nudge_injected", {
        message: `[agent:knowledge-nudge] injected turnsSince=${turnsSinceRecorded}`,
        fields: { turnsSince: turnsSinceRecorded },
      });
      turnsSinceRecorded = 0;
      return [{ source: "knowledge-nudge", content: formatSystemReminder(KNOWLEDGE_NUDGE_TEXT) }];
    },
    onToolResult({ result }) {
      if (result.toolName === UPDATE_KNOWLEDGE_TOOL_NAME && !result.isError) recordedThisTurn = true;
    },
    afterTurn() {
      turnsSinceRecorded = recordedThisTurn ? 0 : turnsSinceRecorded + 1;
      recordedThisTurn = false;
    },
  };
}
