// @summary Main agent loop that iterates turns, manages tools, and handles retries
import { zodToJsonSchema } from "zod-to-json-schema";
import { EventStream } from "../event-stream";
import { withRetry } from "../provider/retry";
import type { Model, StreamContext, StreamFunction, SystemSection, ToolDefinition } from "../provider/types";
import { resolveMaxTokens } from "../provider/types";
import { executeTool } from "../tool/executor";
import type { Tool, ToolContext, ToolRegistry } from "../tool/types";
import type { AssistantMessage, Message, ToolCallBlock, ToolResultMessage, Usage } from "../types";
import { debug } from "../util/debug";
import { LoopDetector } from "./loop-detector";
import type { AgentEvent, AgentLoopConfig, SerializableError } from "./types";
import { MODE_SYSTEM_PROMPT_SUFFIXES, PLAN_MODE_ALLOWED_TOOLS } from "./types";

export interface AgentTurnRuntime {
  activeTools: AgentLoopConfig["tools"];
  registry: ToolRegistry;
  effectiveSystemPrompt: SystemSection[];
  streamFunction: StreamFunction;
}

export interface ToolExecutionRecord {
  toolCall: ToolCallBlock;
  toolResult: ToolResultMessage;
  includeInConversation: boolean;
}

export interface ToolExecutionBatch {
  executions: ToolExecutionRecord[];
  abortAfterTurn: boolean;
}

// D070: Map tool name to permission category for deny-filtering
export function toolPermission(toolName: string): "read" | "write" | "execute" {
  if (toolName === "bash") return "execute";
  if (toolName === "write" || toolName === "apply_patch") return "write";
  return "read";
}

// D070: Remove tools that are statically denied by config-level rules.
// Session-scoped rules are NOT used here — they only affect ctx.approve() at call time.
export function filterAllowedTools(
  tools: AgentLoopConfig["tools"],
  engine: AgentLoopConfig["permissionEngine"],
): AgentLoopConfig["tools"] {
  if (!engine) return tools;
  return tools.filter((tool) => {
    const action = engine.evaluate({
      permission: toolPermission(tool.name),
      toolName: tool.name,
      description: tool.description,
    });
    return action !== "deny";
  });
}

// D086: Convert Error to serializable representation
export function toSerializableError(err: unknown): SerializableError {
  if (err instanceof Error) {
    return { message: err.message, name: err.name, stack: err.stack };
  }
  return { message: String(err), name: "Error" };
}

/** Drain pending steering messages into allMessages and emit the same event payload as before. */
export function drainSteering(
  config: AgentLoopConfig,
  allMessages: Message[],
  stream: EventStream<AgentEvent, Message[]>,
): Message[] {
  if (!config.getSteeringMessages) return [];
  const msgs = config.getSteeringMessages();
  if (msgs.length === 0) return [];
  for (const msg of msgs) allMessages.push(msg);
  stream.push({ type: "steering_injected", messageCount: msgs.length, messages: msgs });
  return msgs;
}

export function createTurnRuntime(
  config: AgentLoopConfig,
  stream: EventStream<AgentEvent, Message[]>,
): AgentTurnRuntime {
  // D087: Filter tools for plan mode (read-only exploration)
  const activeMode = config.mode ?? "default";
  const modeFilteredTools =
    activeMode === "plan" ? config.tools.filter((t) => PLAN_MODE_ALLOWED_TOOLS.has(t.name)) : config.tools;
  // D070: Filter tools denied by config-level permission rules (session rules only affect prompt-time)
  const activeTools = filterAllowedTools(modeFilteredTools, config.permissionEngine);
  const registry = new Map(activeTools.map((t) => [t.name, t]));

  // D087: Append mode instructions as a section (after base prompt to preserve its prefix)
  const effectiveSystemPrompt: SystemSection[] =
    activeMode === "default"
      ? config.systemPrompt
      : [
          ...config.systemPrompt,
          { tag: "collaboration_mode", label: "mode", content: MODE_SYSTEM_PROMPT_SUFFIXES[activeMode] },
        ];

  // D010: Wrap stream function with retry
  const streamFunction = withRetry(config.streamFunction, {
    maxAttempts: config.maxRetries ?? 5,
    baseDelayMs: config.retryBaseDelayMs ?? 1000,
    maxDelayMs: config.retryMaxDelayMs ?? 30_000,
    signal: config.signal,
    onRetry: (attempt, delayMs, _error) => {
      stream.push({
        type: "status_change",
        status: "retry",
        retry: { attempt, delayMs },
      });
    },
  });

  return {
    activeTools,
    registry,
    effectiveSystemPrompt,
    streamFunction,
  };
}

export function agentLoop(messages: Message[], config: AgentLoopConfig): EventStream<AgentEvent, Message[]> {
  const stream = new EventStream<AgentEvent, Message[]>(
    (event) => event.type === "agent_end",
    (event) => (event as { type: "agent_end"; messages: Message[] }).messages,
  );

  runLoop(messages, config, stream).catch((err) => {
    stream.push({ type: "error", error: toSerializableError(err), fatal: true });
    // Complete the stream gracefully so the result promise resolves
    // instead of leaving an unhandled rejection. Consumers see the error event.
    stream.push({ type: "agent_end", messages: [...messages] });
    stream.end([...messages]);
  });

  return stream;
}

async function runLoop(
  messages: Message[],
  config: AgentLoopConfig,
  stream: EventStream<AgentEvent, Message[]>,
): Promise<void> {
  // D086: Counter scoped per invocation — itemIds are deterministic within each agentLoop call
  let itemCounter = 0;
  const generateItemId = () => `item-${++itemCounter}`;

  const allMessages = [...messages];
  let turnCount = 0;
  const maxTurns = config.maxTurns;

  const loopDetector = new LoopDetector();
  const turnRuntime = createTurnRuntime(config, stream);

  stream.push({ type: "agent_start" });

  while (maxTurns === undefined || turnCount < maxTurns) {
    if (config.signal?.aborted) {
      debug("[AgentLoop] signal aborted at top-of-loop, breaking after %d turns", turnCount);
      break;
    }
    turnCount++;

    const turnId = `turn-${turnCount}`;
    stream.push({ type: "turn_start", turnId });

    // Drain steering before LLM call
    drainSteering(config, allMessages, stream);

    // 1. Stream LLM response (with retry)
    const assistantMessage = await streamAssistantResponse(allMessages, config, turnRuntime, stream, generateItemId);
    allMessages.push(assistantMessage);

    // Emit usage after each turn
    stream.push({
      type: "usage",
      usage: assistantMessage.usage,
      cost: calculateCost(config.model, assistantMessage.usage),
    });

    // 2. Check for tool calls
    const toolCalls = assistantMessage.content.filter((b): b is ToolCallBlock => b.type === "tool_call");

    if (toolCalls.length === 0) {
      // Peek only — drain happens at loop top on next iteration
      const hasPending = config.hasPendingMessages?.() ?? false;
      stream.push({
        type: "turn_end",
        turnId,
        message: assistantMessage,
        toolResults: [],
      });
      if (hasPending) continue;
      break;
    }

    // 3. Execute tools — D015: parallel when all tools support it, sequential otherwise
    const { executions, abortAfterTurn } = await executeToolCalls(
      toolCalls,
      config,
      turnRuntime,
      stream,
      generateItemId,
    );
    const toolResults = executions.map((execution) => execution.toolResult);

    for (const execution of executions) {
      if (!execution.includeInConversation) continue;
      allMessages.push(execution.toolResult);
      loopDetector.record(execution.toolCall.name, execution.toolCall.input);
    }

    const loopResult = loopDetector.check();
    if (loopResult.detected) {
      stream.push({
        type: "loop_detected",
        patternLength: loopResult.patternLength!,
        toolName: loopResult.toolName!,
      });
      allMessages.push({
        role: "user",
        content: `[WARNING: Loop detected — tool "${loopResult.toolName}" is being called in a repeating pattern (length ${loopResult.patternLength}). Try a different approach.]`,
        timestamp: Date.now(),
      });
    }

    stream.push({
      type: "turn_end",
      turnId,
      message: assistantMessage,
      toolResults,
    });

    if (abortAfterTurn) break;
    // Loop continues — LLM sees tool results and responds
  }

  stream.push({ type: "agent_end", messages: allMessages });
  stream.end(allMessages);
}

export async function streamAssistantResponse(
  messages: Message[],
  config: AgentLoopConfig,
  turnRuntime: AgentTurnRuntime,
  agentStream: EventStream<AgentEvent, Message[]>,
  generateItemId: () => string,
): Promise<AssistantMessage> {
  // Debug: log last 5 messages before every LLM call
  const tail = messages.slice(-5);
  const debugScope = buildDebugScope(config);
  debug(
    "[AgentLoop]%s Sending %d messages to %s, last 5: %s",
    debugScope ? ` ${debugScope}` : "",
    messages.length,
    config.model.id,
    JSON.stringify(
      tail.map((m) => {
        if (m.role === "user")
          return { role: "user", content: typeof m.content === "string" ? m.content.slice(0, 60) : "(blocks)" };
        if (m.role === "assistant")
          return { role: "assistant", blocks: m.content.map((b) => b.type), stop: m.stopReason };
        if (m.role === "tool_result") return { role: "tool_result", tool: m.toolName, err: m.isError };
        return { role: (m as { role: string }).role };
      }),
    ),
  );

  const context: StreamContext = {
    systemPrompt: turnRuntime.effectiveSystemPrompt,
    messages,
    tools: turnRuntime.activeTools.map(toolToDefinition),
    sessionId: config.sessionId,
  };

  const requestStartedAt = Date.now();
  const providerStream = turnRuntime.streamFunction(config.model, context, {
    signal: config.signal,
    effort: config.effort ?? "medium",
    maxTokens: resolveMaxTokens(config.model, config.reservePercent),
  });

  let currentMessage: AssistantMessage | undefined;
  const messageItemId = generateItemId();

  for await (const event of providerStream) {
    if (event.type === "done") {
      currentMessage = event.message;
      agentStream.push({ type: "message_end", itemId: messageItemId, message: event.message });
    } else if (event.type === "error") {
      // Consume the rejected result to prevent unhandled rejection
      providerStream.result().catch(() => {});
      throw event.error;
    } else if (event.type === "start") {
      // message_start emitted when we have first delta
    } else if (event.type === "text_delta") {
      if (!currentMessage) {
        currentMessage = createEmptyAssistantMessage(config.model.id);
        agentStream.push({ type: "message_start", itemId: messageItemId, message: currentMessage });
      }
      agentStream.push({
        type: "message_delta",
        itemId: messageItemId,
        message: currentMessage,
        delta: { type: "text_delta", delta: event.delta },
      });
    } else if (event.type === "thinking_delta") {
      if (!currentMessage) {
        currentMessage = createEmptyAssistantMessage(config.model.id);
        agentStream.push({ type: "message_start", itemId: messageItemId, message: currentMessage });
      }
      agentStream.push({
        type: "message_delta",
        itemId: messageItemId,
        message: currentMessage,
        delta: { type: "thinking_delta", delta: event.delta },
      });
    }
    // text_end, thinking_end, tool_call_*, usage — consumed silently
    // (final data comes from the "done" event's AssistantMessage)
  }

  if (!currentMessage) {
    if (config.signal?.aborted) {
      debug("[AgentLoop] provider stream ended without message (aborted)");
      throw new Error("Aborted");
    }
    throw new Error("Provider stream ended without producing a message");
  }

  // The final message comes from the done event via providerStream.result()
  const result = await providerStream.result();
  logAssistantResponseSummary(config, result.message, Date.now() - requestStartedAt);
  return result.message;
}

export async function executeToolCalls(
  toolCalls: ToolCallBlock[],
  config: AgentLoopConfig,
  turnRuntime: AgentTurnRuntime,
  stream: EventStream<AgentEvent, Message[]>,
  generateItemId: () => string,
): Promise<ToolExecutionBatch> {
  const executions: ToolExecutionRecord[] = [];
  let abortAfterTurn = false;

  /** Build a ToolContext for a specific tool call + pre-allocated itemId */
  const buildToolContext = (toolCall: ToolCallBlock, toolItemId: string): ToolContext => ({
    toolCallId: toolCall.id,
    signal: config.signal ?? new AbortController().signal,
    approve: async (request) => {
      if (config.permissionEngine) {
        const action = config.permissionEngine.evaluate(request);
        if (action === "allow") return "once";
        if (action === "deny") return "reject";
      }
      if (!config.approve) return "once";
      const response = await config.approve(request);
      if (response === "always" && config.permissionEngine) {
        config.permissionEngine.remember(request, "allow");
      }
      return response;
    },
    ask: config.ask ? (request) => config.ask!(request) : undefined,
    onUpdate: (partial) => {
      stream.push({
        type: "tool_update",
        itemId: toolItemId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        partialResult: partial,
      });
    },
  });

  const allParallel =
    toolCalls.length > 1 && toolCalls.every((toolCall) => turnRuntime.registry.get(toolCall.name)?.supportParallel);

  if (allParallel) {
    const itemIds = toolCalls.map(() => generateItemId());

    for (let i = 0; i < toolCalls.length; i++) {
      stream.push({
        type: "tool_start",
        itemId: itemIds[i],
        toolCallId: toolCalls[i].id,
        toolName: toolCalls[i].name,
        input: toolCalls[i].input,
      });
    }

    const results = await Promise.all(
      toolCalls.map((toolCall, i) =>
        executeTool(turnRuntime.registry, toolCall, buildToolContext(toolCall, itemIds[i])),
      ),
    );

    for (let i = 0; i < toolCalls.length; i++) {
      const result = results[i];
      const toolCall = toolCalls[i];
      const toolResult: ToolResultMessage = {
        role: "tool_result",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        output: result.output,
        isError: !!result.metadata?.error,
        timestamp: Date.now(),
        render: result.render,
      };

      stream.push({
        type: "tool_end",
        itemId: itemIds[i],
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        output: result.output,
        isError: toolResult.isError,
      });

      executions.push({
        toolCall,
        toolResult,
        includeInConversation: !result.abortRequested,
      });

      if (result.abortRequested) {
        abortAfterTurn = true;
        break;
      }
    }

    return { executions, abortAfterTurn };
  }

  for (const toolCall of toolCalls) {
    if (config.signal?.aborted) {
      debug("[AgentLoop] signal aborted before tool %s, breaking tool loop", toolCall.name);
      break;
    }

    const toolItemId = generateItemId();

    stream.push({
      type: "tool_start",
      itemId: toolItemId,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      input: toolCall.input,
    });

    const result = await executeTool(turnRuntime.registry, toolCall, buildToolContext(toolCall, toolItemId));
    const toolResult: ToolResultMessage = {
      role: "tool_result",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      output: result.output,
      isError: !!result.metadata?.error,
      timestamp: Date.now(),
      render: result.render,
    };

    stream.push({
      type: "tool_end",
      itemId: toolItemId,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      output: result.output,
      isError: toolResult.isError,
    });

    executions.push({
      toolCall,
      toolResult,
      includeInConversation: !result.abortRequested,
    });

    if (result.abortRequested) {
      abortAfterTurn = true;
      break;
    }
  }

  return { executions, abortAfterTurn };
}

function buildDebugScope(config: AgentLoopConfig): string {
  const effectiveEffort = config.effort ?? "high";
  return [
    config.debugThreadId ? `thread=${config.debugThreadId}` : null,
    config.debugTurnId ? `turn=${config.debugTurnId}` : null,
    `effort=${effectiveEffort}`,
  ]
    .filter(Boolean)
    .join(" ");
}

function logAssistantResponseSummary(config: AgentLoopConfig, message: AssistantMessage, elapsedMs: number): void {
  const debugScope = buildDebugScope(config);
  const textLength = message.content.reduce((sum, block) => (block.type === "text" ? sum + block.text.length : sum), 0);
  const thinkingLength = message.content.reduce(
    (sum, block) => (block.type === "thinking" ? sum + block.thinking.length : sum),
    0,
  );
  const toolCalls = message.content.filter((block): block is ToolCallBlock => block.type === "tool_call");

  debug(
    "[AgentLoop]%s Response summary: stop=%s elapsed=%dms text=%d thinking=%d toolCalls=%d tools=%s",
    debugScope ? ` ${debugScope}` : "",
    message.stopReason,
    elapsedMs,
    textLength,
    thinkingLength,
    toolCalls.length,
    toolCalls.length > 0 ? toolCalls.map((call) => call.name).join(",") : "-",
  );
}

export function toolToDefinition(tool: Pick<Tool, "name" | "description" | "parameters">): ToolDefinition {
  const { $schema, ...schema } = zodToJsonSchema(tool.parameters) as Record<string, unknown>;
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: schema,
  };
}

export function createEmptyAssistantMessage(model: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    model,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    stopReason: "end_turn",
    timestamp: Date.now(),
  };
}

export function calculateCost(model: Model, usage: Usage): number {
  const inputCost = (usage.inputTokens / 1_000_000) * (model.inputCostPer1M ?? 0);
  const outputCost = (usage.outputTokens / 1_000_000) * (model.outputCostPer1M ?? 0);
  const cacheReadCost = (usage.cacheReadTokens / 1_000_000) * (model.cacheReadCostPer1M ?? 0);
  const cacheWriteCost = (usage.cacheWriteTokens / 1_000_000) * (model.cacheWriteCostPer1M ?? 0);
  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
}
