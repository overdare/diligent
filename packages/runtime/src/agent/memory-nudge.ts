// @summary Periodic reminder to record durable project memory, driven by memory.nudgeInterval

import { createLogger, type Logger } from "@diligent/logging";
import type { ReminderPolicy } from "./reminder-hook";

const UPDATE_MEMORY_TOOL_NAME = "update_memory";

const MEMORY_NUDGE_TEXT = [
  "If this session has made or changed a decision, changed the remaining work, or revealed a durable preference or correction that a future session in this project would need, record it with update_memory. Otherwise ignore this reminder.",
  "This reminder does not authorize actions and does not change the current task.",
];

export function createMemoryNudge(
  logger: Logger = createLogger({ scope: "runtime.agent.memory-nudge" }),
): ReminderPolicy {
  return {
    id: "memory-nudge",
    buildReminder(_context, elapsedTurns) {
      logger.info("memory_nudge_injected", {
        message: `[agent:memory-nudge] injected turnsSince=${elapsedTurns}`,
        fields: { turnsSince: elapsedTurns },
      });
      return MEMORY_NUDGE_TEXT;
    },
    recordToolResult({ result }) {
      return result.toolName === UPDATE_MEMORY_TOOL_NAME && !result.isError;
    },
  };
}
