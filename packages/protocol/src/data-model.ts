// @summary Zod schemas for Diligent protocol domain models and event payloads
import { z } from "zod";

export const ProtocolVersionSchema = z.literal(1);
export type ProtocolVersion = z.infer<typeof ProtocolVersionSchema>;

export const ModeSchema = z.enum(["default", "plan", "execute"]);
export type Mode = z.infer<typeof ModeSchema>;

export const ThinkingEffortSchema = z.enum(["none", "low", "medium", "high", "max"]);
export type ThinkingEffort = z.infer<typeof ThinkingEffortSchema>;

export const StopReasonSchema = z.enum(["end_turn", "tool_use", "max_tokens", "error", "aborted"]);
export type StopReason = z.infer<typeof StopReasonSchema>;

export const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const TextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});
export type TextBlock = z.infer<typeof TextBlockSchema>;

export const ImageBlockSchema = z.object({
  type: z.literal("image"),
  source: z.object({
    type: z.literal("base64"),
    media_type: z.string(),
    data: z.string(),
  }),
});
export type ImageBlock = z.infer<typeof ImageBlockSchema>;

export const LocalImageBlockSchema = z.object({
  type: z.literal("local_image"),
  path: z.string(),
  mediaType: z.string(),
  fileName: z.string().optional(),
});
export type LocalImageBlock = z.infer<typeof LocalImageBlockSchema>;

export const ThinkingBlockSchema = z.object({
  type: z.literal("thinking"),
  thinking: z.string(),
  signature: z.string().optional(),
});
export type ThinkingBlock = z.infer<typeof ThinkingBlockSchema>;

export const ToolCallBlockSchema = z.object({
  type: z.literal("tool_call"),
  id: z.string(),
  name: z.string(),
  input: z.record(z.unknown()),
});
export type ToolCallBlock = z.infer<typeof ToolCallBlockSchema>;

export const ContentBlockSchema = z.union([
  TextBlockSchema,
  ImageBlockSchema,
  LocalImageBlockSchema,
  ThinkingBlockSchema,
  ToolCallBlockSchema,
]);
export type ContentBlock = z.infer<typeof ContentBlockSchema>;

export const UserMessageSchema = z.object({
  role: z.literal("user"),
  content: z.union([z.string(), z.array(ContentBlockSchema)]),
  timestamp: z.number().int(),
});
export type UserMessage = z.infer<typeof UserMessageSchema>;

export const AssistantMessageSchema = z.object({
  role: z.literal("assistant"),
  content: z.array(ContentBlockSchema),
  model: z.string(),
  usage: UsageSchema,
  stopReason: StopReasonSchema,
  timestamp: z.number().int(),
});
export type AssistantMessage = z.infer<typeof AssistantMessageSchema>;

// ── Structured render blocks for tool results (P040) ─────────────────────────

export const RenderToneSchema = z.enum(["default", "success", "warning", "danger", "info"]);
export type RenderTone = z.infer<typeof RenderToneSchema>;

export const SummaryBlockSchema = z.object({
  type: z.literal("summary"),
  text: z.string(),
  tone: RenderToneSchema.optional(),
});
export type SummaryBlock = z.infer<typeof SummaryBlockSchema>;

export const ToolRenderTextBlockSchema = z.object({
  type: z.literal("text"),
  title: z.string().optional(),
  text: z.string(),
  isError: z.boolean().optional(),
});
export type ToolRenderTextBlock = z.infer<typeof ToolRenderTextBlockSchema>;

export const KeyValueBlockSchema = z.object({
  type: z.literal("key_value"),
  title: z.string().optional(),
  items: z.array(z.object({ key: z.string(), value: z.string() })),
});
export type KeyValueBlock = z.infer<typeof KeyValueBlockSchema>;

export const ListBlockSchema = z.object({
  type: z.literal("list"),
  title: z.string().optional(),
  ordered: z.boolean().optional(),
  items: z.array(z.string()),
});
export type ListBlock = z.infer<typeof ListBlockSchema>;

export const TableBlockSchema = z.object({
  type: z.literal("table"),
  title: z.string().optional(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string())),
});
export type TableBlock = z.infer<typeof TableBlockSchema>;

// TreeNode uses lazy recursion to allow nested children
const TreeNodeSchema: z.ZodType<{ label: string; children?: { label: string; children?: unknown[] }[] }> = z.lazy(() =>
  z.object({
    label: z.string(),
    children: z.array(TreeNodeSchema).optional(),
  }),
);
export type TreeNode = { label: string; children?: TreeNode[] };

export const TreeBlockSchema = z.object({
  type: z.literal("tree"),
  title: z.string().optional(),
  nodes: z.array(TreeNodeSchema),
});
export type TreeBlock = z.infer<typeof TreeBlockSchema>;

export const StatusBadgesBlockSchema = z.object({
  type: z.literal("status_badges"),
  title: z.string().optional(),
  items: z.array(z.object({ label: z.string(), tone: RenderToneSchema.optional() })),
});
export type StatusBadgesBlock = z.infer<typeof StatusBadgesBlockSchema>;

export const FileBlockSchema = z.object({
  type: z.literal("file"),
  filePath: z.string(),
  content: z.string().optional(),
  offset: z.number().int().optional(),
  limit: z.number().int().optional(),
  isError: z.boolean().optional(),
});
export type FileBlock = z.infer<typeof FileBlockSchema>;

export const CommandBlockSchema = z.object({
  type: z.literal("command"),
  command: z.string(),
  output: z.string().optional(),
  isError: z.boolean().optional(),
});
export type CommandBlock = z.infer<typeof CommandBlockSchema>;

export const DiffHunkSchema = z.object({
  oldString: z.string().optional(),
  newString: z.string().optional(),
});
export type DiffHunk = z.infer<typeof DiffHunkSchema>;

export const DiffFileSchema = z.object({
  filePath: z.string(),
  action: z.enum(["Add", "Update", "Delete", "Move"]).optional(),
  movedTo: z.string().optional(),
  hunks: z.array(DiffHunkSchema),
});
export type DiffFile = z.infer<typeof DiffFileSchema>;

export const DiffBlockSchema = z.object({
  type: z.literal("diff"),
  files: z.array(DiffFileSchema),
  output: z.string().optional(),
  isError: z.boolean().optional(),
});
export type DiffBlock = z.infer<typeof DiffBlockSchema>;

export const ToolRenderBlockSchema = z.discriminatedUnion("type", [
  SummaryBlockSchema,
  ToolRenderTextBlockSchema,
  KeyValueBlockSchema,
  ListBlockSchema,
  TableBlockSchema,
  TreeBlockSchema,
  StatusBadgesBlockSchema,
  FileBlockSchema,
  CommandBlockSchema,
  DiffBlockSchema,
]);
export type ToolRenderBlock = z.infer<typeof ToolRenderBlockSchema>;

export const ToolRenderPayloadSchema = z.object({
  version: z.literal(2),
  inputSummary: z.string().optional(),
  outputSummary: z.string().optional(),
  blocks: z.array(ToolRenderBlockSchema),
});
export type ToolRenderPayload = z.infer<typeof ToolRenderPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────────────

export const ToolResultMessageSchema = z.object({
  role: z.literal("tool_result"),
  toolCallId: z.string(),
  toolName: z.string(),
  output: z.string(),
  isError: z.boolean(),
  timestamp: z.number().int(),
  render: ToolRenderPayloadSchema.optional(),
});
export type ToolResultMessage = z.infer<typeof ToolResultMessageSchema>;

export const MessageSchema = z.union([UserMessageSchema, AssistantMessageSchema, ToolResultMessageSchema]);
export type Message = z.infer<typeof MessageSchema>;

export const MessageDeltaSchema = z.union([
  z.object({ type: z.literal("text_delta"), delta: z.string() }),
  z.object({ type: z.literal("thinking_delta"), delta: z.string() }),
]);
export type MessageDelta = z.infer<typeof MessageDeltaSchema>;

export const SerializableErrorSchema = z.object({
  message: z.string(),
  name: z.string(),
  stack: z.string().optional(),
});
export type SerializableError = z.infer<typeof SerializableErrorSchema>;

export const CollabAgentStatusSchema = z.enum(["pending", "running", "completed", "errored", "shutdown"]);
export type CollabAgentStatus = z.infer<typeof CollabAgentStatusSchema>;

export const CollabAgentRefSchema = z.object({
  threadId: z.string(),
  nickname: z.string().optional(),
  description: z.string().optional(),
});
export type CollabAgentRef = z.infer<typeof CollabAgentRefSchema>;

export const CollabAgentStatusEntrySchema = z.object({
  threadId: z.string(),
  nickname: z.string().optional(),
  status: CollabAgentStatusSchema,
  message: z.string().optional(),
});
export type CollabAgentStatusEntry = z.infer<typeof CollabAgentStatusEntrySchema>;

export const AgentEventSchema = z.union([
  z.object({ type: z.literal("agent_start") }),
  z.object({ type: z.literal("agent_end"), messages: z.array(MessageSchema) }),
  z.object({
    type: z.literal("turn_start"),
    turnId: z.string(),
    childThreadId: z.string().optional(),
    nickname: z.string().optional(),
    turnNumber: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("turn_end"),
    turnId: z.string(),
    message: AssistantMessageSchema,
    toolResults: z.array(ToolResultMessageSchema),
  }),
  z.object({ type: z.literal("message_start"), itemId: z.string(), message: AssistantMessageSchema }),
  z.object({
    type: z.literal("message_delta"),
    itemId: z.string(),
    message: AssistantMessageSchema,
    delta: MessageDeltaSchema,
  }),
  z.object({ type: z.literal("message_end"), itemId: z.string(), message: AssistantMessageSchema }),
  z.object({
    type: z.literal("tool_start"),
    itemId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    input: z.unknown(),
    childThreadId: z.string().optional(),
    nickname: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool_update"),
    itemId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    partialResult: z.string(),
    childThreadId: z.string().optional(),
    nickname: z.string().optional(),
  }),
  z.object({
    type: z.literal("tool_end"),
    itemId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    output: z.string(),
    isError: z.boolean(),
    render: ToolRenderPayloadSchema.optional(),
    childThreadId: z.string().optional(),
    nickname: z.string().optional(),
  }),
  z.object({
    type: z.literal("status_change"),
    status: z.enum(["idle", "busy"]),
  }),
  z.object({ type: z.literal("usage"), usage: UsageSchema, cost: z.number() }),
  z.object({ type: z.literal("error"), error: SerializableErrorSchema, fatal: z.boolean() }),
  z.object({ type: z.literal("compaction_start"), estimatedTokens: z.number().int().nonnegative() }),
  z.object({
    type: z.literal("compaction_end"),
    tokensBefore: z.number().int().nonnegative(),
    tokensAfter: z.number().int().nonnegative(),
    summary: z.string(),
  }),
  z.object({ type: z.literal("knowledge_saved"), knowledgeId: z.string(), content: z.string() }),
  z.object({
    type: z.literal("steering_injected"),
    messageCount: z.number().int().nonnegative(),
    messages: z.array(MessageSchema),
  }),
  // Collab — sub-agent orchestration events (3 pairs of begin/end)
  z.object({
    type: z.literal("collab_spawn_begin"),
    callId: z.string(),
    prompt: z.string(),
    agentType: z.string(),
  }),
  z.object({
    type: z.literal("collab_spawn_end"),
    callId: z.string(),
    childThreadId: z.string(),
    nickname: z.string().optional(),
    agentType: z.string().optional(),
    description: z.string().optional(),
    prompt: z.string(),
    status: CollabAgentStatusSchema,
    message: z.string().optional(),
  }),
  z.object({
    type: z.literal("collab_wait_begin"),
    callId: z.string(),
    agents: z.array(CollabAgentRefSchema),
  }),
  z.object({
    type: z.literal("collab_wait_end"),
    callId: z.string(),
    agentStatuses: z.array(CollabAgentStatusEntrySchema),
    timedOut: z.boolean(),
  }),
  z.object({
    type: z.literal("collab_close_begin"),
    callId: z.string(),
    childThreadId: z.string(),
    nickname: z.string().optional(),
  }),
  z.object({
    type: z.literal("collab_close_end"),
    callId: z.string(),
    childThreadId: z.string(),
    nickname: z.string().optional(),
    status: CollabAgentStatusSchema,
    message: z.string().optional(),
  }),
  // Collab — interaction events (send_input)
  z.object({
    type: z.literal("collab_interaction_begin"),
    callId: z.string(),
    receiverThreadId: z.string(),
    receiverNickname: z.string().optional(),
    prompt: z.string(),
  }),
  z.object({
    type: z.literal("collab_interaction_end"),
    callId: z.string(),
    receiverThreadId: z.string(),
    receiverNickname: z.string().optional(),
    prompt: z.string(),
    status: CollabAgentStatusSchema,
  }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const ThreadStatusSchema = z.enum(["idle", "busy"]);
export type ThreadStatus = z.infer<typeof ThreadStatusSchema>;

export const ThreadItemSchema = z.union([
  z.object({
    type: z.literal("userMessage"),
    itemId: z.string(),
    message: UserMessageSchema,
  }),
  z.object({
    type: z.literal("agentMessage"),
    itemId: z.string(),
    message: AssistantMessageSchema,
  }),
  z.object({
    type: z.literal("toolCall"),
    itemId: z.string(),
    toolCallId: z.string(),
    toolName: z.string(),
    input: z.unknown(),
    output: z.string().optional(),
    isError: z.boolean().optional(),
    render: ToolRenderPayloadSchema.optional(),
  }),
  z.object({
    type: z.literal("compaction"),
    itemId: z.string(),
    summary: z.string(),
    tokensBefore: z.number().int().nonnegative(),
    tokensAfter: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("knowledge"),
    itemId: z.string(),
    knowledgeId: z.string(),
    content: z.string(),
  }),
  z.object({
    type: z.literal("loopDetection"),
    itemId: z.string(),
    patternLength: z.number().int().positive(),
    toolName: z.string(),
  }),
  z.object({
    type: z.literal("collabEvent"),
    itemId: z.string(),
    eventKind: z.enum(["spawn", "wait", "close", "interaction"]),
    childThreadId: z.string().optional(),
    nickname: z.string().optional(),
    description: z.string().optional(),
    status: CollabAgentStatusSchema.optional(),
    message: z.string().optional(),
    agents: z.array(CollabAgentStatusEntrySchema).optional(),
    timedOut: z.boolean().optional(),
  }),
]);
export type ThreadItem = z.infer<typeof ThreadItemSchema>;

export const ThreadItemDeltaSchema = z.union([
  z.object({
    type: z.literal("messageText"),
    itemId: z.string(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("messageThinking"),
    itemId: z.string(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("toolOutput"),
    itemId: z.string(),
    delta: z.string(),
  }),
]);
export type ThreadItemDelta = z.infer<typeof ThreadItemDeltaSchema>;

export const PermissionSchema = z.enum(["read", "write", "execute"]);
export type Permission = z.infer<typeof PermissionSchema>;

export const ApprovalRequestSchema = z.object({
  permission: PermissionSchema,
  toolName: z.string(),
  description: z.string(),
  details: z.record(z.unknown()).optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;

export const ApprovalResponseSchema = z.enum(["once", "always", "reject"]);
export type ApprovalResponse = z.infer<typeof ApprovalResponseSchema>;

export const UserInputOptionSchema = z.object({
  label: z.string(),
  description: z.string(),
});
export type UserInputOption = z.infer<typeof UserInputOptionSchema>;

export const UserInputQuestionSchema = z.object({
  id: z.string(),
  header: z.string(),
  question: z.string(),
  options: z.array(UserInputOptionSchema).min(1),
  allow_multiple: z.boolean().optional(),
  is_other: z.boolean().optional(),
  is_secret: z.boolean().optional(),
});
export type UserInputQuestion = z.infer<typeof UserInputQuestionSchema>;

export const UserInputSourceSchema = z.object({
  threadId: z.string(),
  nickname: z.string(),
});
export type UserInputSource = z.infer<typeof UserInputSourceSchema>;

export const UserInputRequestSchema = z.object({
  questions: z.array(UserInputQuestionSchema).min(1),
  /** Present when the request originates from a sub-agent rather than the main agent. */
  source: UserInputSourceSchema.optional(),
});
export type UserInputRequest = z.infer<typeof UserInputRequestSchema>;

export const UserInputAnswerSchema = z.union([z.string(), z.array(z.string())]);
export type UserInputAnswer = z.infer<typeof UserInputAnswerSchema>;

export const UserInputResponseSchema = z.object({
  answers: z.record(UserInputAnswerSchema),
});
export type UserInputResponse = z.infer<typeof UserInputResponseSchema>;

export const KnowledgeTypeSchema = z.enum(["pattern", "discovery", "preference", "correction", "backlog"]);
export type KnowledgeType = z.infer<typeof KnowledgeTypeSchema>;

export const KnowledgeEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  sessionId: z.string().optional(),
  type: KnowledgeTypeSchema,
  content: z.string(),
  confidence: z.number().min(0).max(1),
  supersedes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type KnowledgeEntry = z.infer<typeof KnowledgeEntrySchema>;

export const SessionSummarySchema = z.object({
  id: z.string(),
  path: z.string(),
  cwd: z.string(),
  name: z.string().optional(),
  created: z.string(),
  modified: z.string(),
  messageCount: z.number().int().nonnegative(),
  firstUserMessage: z.string().optional(),
  parentSession: z.string().optional(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const ProviderNameSchema = z.enum(["anthropic", "openai", "chatgpt", "gemini"]);
export type ProviderName = z.infer<typeof ProviderNameSchema>;

export const ProviderAuthStatusSchema = z.object({
  provider: ProviderNameSchema,
  configured: z.boolean(),
  maskedKey: z.string().optional(),
  oauthConnected: z.boolean().optional(),
});
export type ProviderAuthStatus = z.infer<typeof ProviderAuthStatusSchema>;

export const ProtocolCapabilitiesSchema = z.object({
  supportsFollowUp: z.boolean(),
  supportsApprovals: z.boolean(),
  supportsUserInput: z.boolean(),
});
export type ProtocolCapabilities = z.infer<typeof ProtocolCapabilitiesSchema>;
