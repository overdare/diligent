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
  calculateCost,
  createEmptyAssistantMessage,
  createTurnRuntime,
  drainSteering,
  executeToolCalls,
  extractLatestPlanState,
  filterAllowedTools,
  LoopDetector,
  MODE_SYSTEM_PROMPT_SUFFIXES,
  PLAN_MODE_ALLOWED_TOOLS,
  streamAssistantResponse,
  toolPermission,
  toolToDefinition,
  toSerializableError,
  withPlanStateInjected,
} from "./agent/index";
// App server (JSON-RPC)
export type { CreateAppServerConfigOptions, DiligentAppServerConfig } from "./app-server";
export { bindAppServer, createAppServerConfig, DiligentAppServer } from "./app-server";
export type { PermissionAction, PermissionEngine, PermissionRule } from "./approval/index";
// Approval (Phase 5a)
export { createPermissionEngine, createYoloPermissionEngine } from "./approval/index";
// Auth
export type {
  AuthKeys,
  OpenAIOAuthTokens,
} from "./auth/index";
export {
  getAuthFilePath,
  loadAuthStore,
  loadOAuthTokens,
  removeAuthKey,
  removeOAuthTokens,
  saveAuthKey,
  saveOAuthTokens,
} from "./auth/index";
export type { OAuthFlowOptions, PKCEPair, RawTokenResponse } from "./auth/oauth/index";
// Auth/OAuth
export {
  buildOAuthTokens,
  CHATGPT_AUTH_URL,
  CHATGPT_CLIENT_ID,
  CHATGPT_REDIRECT_URI,
  CHATGPT_SCOPES,
  exchangeCodeForTokens,
  generatePKCE,
  openBrowser,
  refreshOAuthTokens,
  runChatGPTOAuth,
  shouldRefresh,
  waitForCallback,
} from "./auth/oauth/index";
export type { AgentEntry, AgentStatus, CollabToolDeps } from "./collab/index";
// Collab tools (non-blocking multi-agent)
export { AgentRegistry, COLLAB_TOOL_NAMES, createCollabTools } from "./collab/index";
// Config
export type {
  DiligentConfig,
  DiscoveredInstruction,
  RuntimeConfig,
  StoredToolsConfig,
  ToolConfigPatch,
  ToolPluginPatch,
  WriteToolsConfigResult,
} from "./config/index";
export {
  applyToolConfigPatch,
  buildSystemPrompt,
  buildSystemPromptWithKnowledge,
  DEFAULT_CONFIG,
  DiligentConfigSchema,
  discoverInstructions,
  getProjectConfigPath,
  loadDiligentConfig,
  loadRuntimeConfig,
  mergeConfig,
  normalizeStoredToolsConfig,
  writeProjectToolsConfig,
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
// Notification Adapter (shared TUI/Web)
export { ProtocolNotificationAdapter } from "./notification-adapter";
// Prompt
export type { SystemPromptVars } from "./prompt/index";
export { buildBaseSystemPrompt } from "./prompt/index";
// Provider
export type {
  Model,
  ModelClass,
  ModelDefinition,
  ProviderErrorType,
  ProviderEvent,
  ProviderName,
  ProviderResult,
  RetryConfig,
  StreamContext,
  StreamFunction,
  StreamOptions,
  SystemSection,
  ToolDefinition,
} from "./provider/index";
export {
  agentTypeToModelClass,
  classifyGeminiError,
  createAnthropicStream,
  createChatGPTStream,
  createGeminiStream,
  createOpenAIStream,
  DEFAULT_MODELS,
  DEFAULT_PROVIDER,
  flattenSections,
  getModelClass,
  getModelInfoList,
  KNOWN_MODELS,
  PROVIDER_HINTS,
  PROVIDER_NAMES,
  ProviderError,
  ProviderManager,
  resolveModel,
  resolveModelForClass,
  withRetry,
} from "./provider/index";
export type { NdjsonParser, RpcMessageSink, RpcMessageSource, RpcPeer } from "./rpc";
export {
  createNdjsonParser,
  formatNdjsonMessage,
  isRpcNotification,
  isRpcRequest,
  isRpcResponse,
  RpcClientSession,
} from "./rpc";
// Session
export type {
  CompactionDetails,
  CompactionEntry,
  ModeChangeEntry,
  ModelChangeEntry,
  RecentUserMessagesResult,
  ResumeSessionOptions,
  SessionContext,
  SessionEntry,
  SessionFileLine,
  SessionHeader,
  SessionInfo,
  SessionInfoEntry,
  SessionManagerConfig,
  SessionMessageEntry,
} from "./session/index";
export {
  appendEntry,
  buildSessionContext,
  createSessionFile,
  estimateTokens,
  extractFileOperations,
  findRecentUserMessages,
  formatFileOperations,
  generateEntryId,
  generateSessionId,
  generateSummary,
  isSummaryMessage,
  listSessions,
  readSessionFile,
  SESSION_VERSION,
  SessionManager,
  SessionWriter,
  SUMMARY_PREFIX,
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
  UserInputSource,
} from "./tool/index";
export { executeTool, ToolRegistryBuilder } from "./tool/index";
// Built-in tools
export type {
  BuildDefaultToolsResult,
  PluginLoadError,
  PluginLoadResult,
  PluginManifest,
  PluginStateEntry,
  ToolCatalogResult,
  ToolStateEntry,
  ToolStateReason,
} from "./tools/index";
export {
  bashTool,
  buildDefaultTools,
  buildToolCatalog,
  createAddKnowledgeTool,
  createEditTool,
  createGlobTool,
  createGrepTool,
  createLsTool,
  createPlanTool,
  createReadTool,
  createWriteTool,
  getGlobalPluginPath,
  getGlobalPluginRoot,
  IMMUTABLE_TOOLS,
  isImmutableTool,
  loadPlugin,
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
