import type { AssistantMessage, UserMessage } from "@diligent/protocol";

// Re-exports from protocol (canonical source of truth per ARCHITECTURE.md)
export type {
  AssistantMessage,
  ContentBlock,
  ImageBlock,
  LocalImageBlock,
  StopReason,
  TextBlock,
  ThinkingBlock,
  ToolCallBlock,
  Usage,
  UserMessage,
} from "@diligent/protocol";

// Core-owned types: ToolResultMessage uses a weaker render type (ToolRenderPayloadLike)
// to decouple tool implementations from the full protocol render block schema.
export interface ToolRenderPayloadLike {
  version: 2;
  inputSummary?: string;
  outputSummary?: string;
  blocks: unknown[];
}

export interface ToolStartRenderPayloadLike {
  version: 2;
  inputSummary?: string;
  blocks: unknown[];
}

export interface ToolResultMessage {
  role: "tool_result";
  toolCallId: string;
  toolName: string;
  output: string;
  isError: boolean;
  timestamp: number;
  render?: ToolRenderPayloadLike;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;
