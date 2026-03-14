// @summary Stateful Agent class — holds member vars, steering queue, and subscriber list; prompt() runs the loop

import { resolveModel } from "../llm/models";
import { withRetry } from "../llm/retry";
import { resolveStream } from "../llm/stream-resolver";
import type { Model, StreamFunction, SystemSection, ThinkingEffort } from "../llm/types";
import type { Tool } from "../tool/types";
import type { Message } from "../types";
import { runCompaction } from "./compaction";
import { runAgentLoop } from "./loop";
import type { LoopRuntime } from "./loop";
import type { AgentOptions, CompactionConfig } from "./types";
import { AgentStream, LLMRetryConfig } from "./types";

export class Agent {
  model: Model;
  systemPrompt: SystemSection[];
  tools: Tool[];
  effort: ThinkingEffort;
  private llmStream: StreamFunction;
  private retryConfig: LLMRetryConfig;
  private compactionConfig: CompactionConfig;
  private messages: Message[] = [];
  private pendingSteeringMessages: Message[] = [];
  private sessionId?: string;
  readonly agentStream = new AgentStream();

  constructor(
    model: string | Model,
    systemPrompt: SystemSection[],
    tools: Tool[],
    opts?: AgentOptions
  ) {
    this.model = typeof model === "string" ? resolveModel(model) : model;
    this.systemPrompt = systemPrompt;
    this.tools = tools;
    this.effort = opts?.effort ?? "medium";
    this.compactionConfig = opts?.compaction ?? {
      reservePercent: 16,
      keepRecentTokens: 20_000,
    };
    this.retryConfig = opts?.retry ?? {
      maxRetries: 5,
      baseDelayMs: 1_000,
      maxDelayMs: 30_000,
    };
    this.llmStream = this.wrapWithRetry(opts?.streamFn ?? resolveStream(this.model.provider));
  }

  private wrapWithRetry(fn: StreamFunction): StreamFunction {
    return withRetry(fn, {
      maxAttempts: this.retryConfig.maxRetries ?? 5,
      baseDelayMs: this.retryConfig.baseDelayMs ?? 1_000,
      maxDelayMs: this.retryConfig.maxDelayMs ?? 30_000,
    });
  }

  /** Subscribe to agent events. Returns an unsubscribe function. */
  subscribe(fn: (event: import("./types").CoreAgentEvent) => void): () => void {
    return this.agentStream.subscribe(fn);
  }

  /** Restore conversation history (called once when resuming a session). */
  restore(messages: Message[]): void {
    this.messages = [...messages];
  }

  /** Get the current conversation messages. */
  getMessages(): Message[] {
    return this.messages;
  }

  /**
   * Run the agent loop with a new user message.
   * Agent runs against a staged history and commits it only if the loop succeeds.
   * Resolves with the final message array when the loop ends.
   */
  async prompt(userMessage: Message, signal?: AbortSignal): Promise<Message[]> {
    const nextMessages = [...this.messages, userMessage];
    const result = await runAgentLoop(
      nextMessages,
      this.createLoopRuntime(),
      signal,
    );
    this.messages = result;
    return result;
  }

  private createLoopRuntime(): LoopRuntime {
    return {
      config: {
        model: this.model,
        systemPrompt: this.systemPrompt,
        tools: this.tools,
        effort: this.effort,
        compaction: this.compactionConfig,
      },
      streamFunction: this.llmStream,
      stream: this.agentStream,
      sessionId: this.sessionId,
      hooks: {
        drainSteeringMessages: () => this.drainPendingMessages(),
        pendingSteeringCount: () => this.pendingSteeringMessages.length,
      },
    };
  }

  /** Queue a steering message to be injected into the running loop. */
  steer(msg: Message): void {
    this.pendingSteeringMessages.push(msg);
  }

  /** Returns true if there are pending steering messages. */
  hasPendingMessages(): boolean {
    return this.pendingSteeringMessages.length > 0;
  }

  /** Drain all steering messages from the queue. */
  drainPendingMessages(): Message[] {
    return this.pendingSteeringMessages.splice(0);
  }

  setModel(model: string | Model, streamFn?: StreamFunction): void {
    this.model = typeof model === "string" ? resolveModel(model) : model;
    this.llmStream = this.wrapWithRetry(streamFn ?? resolveStream(this.model.provider));
  }

  setEffort(effort: ThinkingEffort): void {
    this.effort = effort;
  }

  setCompactionConfig(compaction: CompactionConfig): void {
    this.compactionConfig = compaction;
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /** Compact internal messages unconditionally, emitting compaction_start/end via stream. */
  async compact(signal?: AbortSignal): Promise<void> {
    const result = await runCompaction({
      messages: this.messages,
      model: this.model,
      systemPrompt: this.systemPrompt,
      compactionConfig: this.compactionConfig ?? { reservePercent: 16, keepRecentTokens: 20_000 },
      streamFn: this.llmStream,
      stream: this.agentStream,
      signal,
    });
    this.messages = result.messages;
  }
}
