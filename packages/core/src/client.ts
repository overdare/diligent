// @summary Browser-safe subset of @diligent/core for web client imports (no Node.js APIs)

export type {
  AgentEvent,
  MessageDelta,
  ModeKind,
  SerializableError,
} from "./agent/types";

export { ProtocolNotificationAdapter } from "./notification-adapter";

export type {
  AssistantMessage,
  ContentBlock,
  ImageBlock,
  Message,
  StopReason,
  TextBlock,
  ThinkingBlock,
  ToolCallBlock,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "./types";
