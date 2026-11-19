// @summary Periodic reminder to record durable project knowledge, driven by knowledge.nudgeInterval

import { createLogger, type Logger } from "@diligent/logging";
import type { ReminderPolicy } from "./reminder-hook";

const UPDATE_KNOWLEDGE_TOOL_NAME = "update_knowledge";

const KNOWLEDGE_NUDGE_TEXT = [
  "If this session has produced a durable, project-specific fact, preference, or correction that a future session would need, record it with update_knowledge. Otherwise ignore this reminder.",
  "This reminder does not authorize actions and does not change the current task.",
];

export function createKnowledgeNudge(
  logger: Logger = createLogger({ scope: "runtime.agent.knowledge-nudge" }),
): ReminderPolicy {
  return {
    id: "knowledge-nudge",
    buildReminder(_context, elapsedTurns) {
      logger.info("knowledge_nudge_injected", {
        message: `[agent:knowledge-nudge] injected turnsSince=${elapsedTurns}`,
        fields: { turnsSince: elapsedTurns },
      });
      return KNOWLEDGE_NUDGE_TEXT;
    },
    recordToolResult({ result }) {
      return result.toolName === UPDATE_KNOWLEDGE_TOOL_NAME && !result.isError;
    },
  };
}
