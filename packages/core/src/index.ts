// Types

// Protocol (shared TUI/Web API contract)
export * as protocol from "@diligent/protocol";
// Agent
export type {
  AgentEvent,
  AgentLoopConfig,
  AgentTypeDef,
  LoopDetectionResult,
  MessageDelta,
  ModeKind,
  SerializableError,
} from "./agent/index";
export {
  agentLoop,
  BUILTIN_AGENT_TYPES,
  LoopDetector,
  MODE_SYSTEM_PROMPT_SUFFIXES,
  PLAN_MODE_ALLOWED_TOOLS,
} from "./agent/index";
// App server (JSON-RPC)
export type { DiligentAppServerConfig, NotificationListener, ServerRequestHandler } from "./app-server";
export { DiligentAppServer } from "./app-server";
export type { PermissionAction, PermissionEngine, PermissionRule } from "./approval/index";
// Approval (Phase 5a)
export { createPermissionEngine } from "./approval/index";
// Auth
export type { AuthKeys, OpenAIOAuthTokens, ProviderName as AuthProviderName } from "./auth/index";
export { getAuthFilePath, loadAuthStore, loadOAuthTokens, saveAuthKey, saveOAuthTokens } from "./auth/index";
export type { OAuthFlowOptions } from "./auth/oauth/index";
// Auth/OAuth
export { refreshOAuthTokens, runChatGPTOAuth, shouldRefresh } from "./auth/oauth/index";
export type { AgentEntry, AgentStatus, CollabToolDeps } from "./collab/index";
// Collab tools (non-blocking multi-agent)
export { AgentRegistry, COLLAB_TOOL_NAMES, createCollabTools } from "./collab/index";
// Config
export type { DiligentConfig, DiscoveredInstruction } from "./config/index";
export {
  buildSystemPrompt,
  buildSystemPromptWithKnowledge,
  DEFAULT_CONFIG,
  DiligentConfigSchema,
  discoverInstructions,
  loadDiligentConfig,
  mergeConfig,
} from "./config/index";
// EventStream
export { EventStream } from "./event-stream";
// Infrastructure
export type { DiligentPaths } from "./infrastructure/index";
export { ensureDiligentDir, resolvePaths } from "./infrastructure/index";
// Knowledge
export type { KnowledgeConfig, KnowledgeEntry, KnowledgeType } from "./knowledge/index";
export {
  appendKnowledge,
  buildKnowledgeSection,
  rankKnowledge,
  readKnowledge,
} from "./knowledge/index";
// Prompt
export type { SystemPromptVars } from "./prompt/index";
export { buildBaseSystemPrompt } from "./prompt/index";
// Provider
export type {
  Model,
  ModelDefinition,
  ProviderErrorType,
  ProviderEvent,
  ProviderResult,
  RetryConfig,
  StreamContext,
  StreamFunction,
  StreamOptions,
  SystemSection,
  ToolDefinition,
} from "./provider/index";
export {
  classifyGeminiError,
  createAnthropicStream,
  createChatGPTStream,
  createGeminiStream,
  createOpenAIStream,
  flattenSections,
  KNOWN_MODELS,
  ProviderError,
  resolveModel,
  withRetry,
} from "./provider/index";
// Session
export type {
  CompactionDetails,
  CompactionEntry,
  CutPointResult,
  ModeChangeEntry,
  ModelChangeEntry,
  ResumeSessionOptions,
  SessionContext,
  SessionEntry,
  SessionFileLine,
  SessionHeader,
  SessionInfo,
  SessionInfoEntry,
  SessionManagerConfig,
  SessionMessageEntry,
  SteeringEntry,
} from "./session/index";
export {
  appendEntry,
  buildSessionContext,
  createSessionFile,
  DeferredWriter,
  estimateTokens,
  extractFileOperations,
  findCutPoint,
  formatFileOperations,
  generateEntryId,
  generateSessionId,
  generateSummary,
  listSessions,
  readSessionFile,
  SESSION_VERSION,
  SessionManager,
  shouldCompact,
} from "./session/index";
// Skills
export type {
  DiscoveryOptions,
  SkillFrontmatter,
  SkillLoadError,
  SkillLoadResult,
  SkillMetadata,
} from "./skills/index";
export { discoverSkills, extractBody, renderSkillsSection } from "./skills/index";
// Tool
export type {
  ApprovalRequest,
  ApprovalResponse,
  Tool,
  ToolContext,
  ToolRegistry,
  ToolResult,
  UserInputQuestion,
  UserInputRequest,
  UserInputResponse,
} from "./tool/index";
export { executeTool, ToolRegistryBuilder } from "./tool/index";
export type { TaskToolDeps } from "./tools/index";
// Built-in tools
export {
  bashTool,
  createAddKnowledgeTool,
  createEditTool,
  createGlobTool,
  createGrepTool,
  createLsTool,
  createPlanTool,
  createReadTool,
  createTaskTool,
  createWriteTool,
  requestUserInputTool,
} from "./tools/index";
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
