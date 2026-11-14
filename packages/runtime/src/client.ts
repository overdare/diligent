// @summary Browser-safe subset of @diligent/core for web client imports (no Node.js APIs)

export type { MessageDelta, SerializableError } from "@diligent/core/agent";
export type {
  AssistantMessage,
  ContentBlock,
  ImageBlock,
  LocalImageBlock,
  Message,
  StopReason,
  TextBlock,
  ThinkingBlock,
  ToolCallBlock,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@diligent/core/message-contract";
export {
  findModelInfo,
  getThinkingEffortOptions,
  getThinkingEffortUsage,
  getThinkingEffortUsageValues,
} from "@diligent/core/model-registry";
export type { Mode } from "./agent/mode";
export type { AgentEvent, ChildAgentEvent, RuntimeAgentEvent } from "./agent-event";
export { type FileLink, parseFileLink } from "./client/file-link";
export { applyGoalSnapshot, goalStopMessage, parseGoalCommand } from "./client/goal-command";
export { formatGoalDuration, goalElapsedMs } from "./client/goal-format";
export { startGoalSync } from "./client/goal-sync";
export { mergeHistoryItems, mergeSessionSummaries } from "./client/history-pages";
export { ProtocolNotificationAdapter } from "./notification-adapter";
