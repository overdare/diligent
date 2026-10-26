// @summary LLM-layer compaction execution — generateSummary, compactMessages, compact (native-first)

import { createLogger } from "@diligent/logging";
import { truncateHeadTail } from "../tool/truncation";
import type { Message, TextBlock } from "../types";
import type { NativeCompactFn } from "./provider/native-compaction";
import { resolveStream } from "./stream-resolver";
import { estimateTokens } from "./tokens";
import type { Model, ProviderName, StreamContext, StreamFunction, SystemSection } from "./types";
import { ProviderError, ProviderErrorType, resolveMaxTokens } from "./types";

const compactionLogger = createLogger({ scope: "llm:compaction" });

// --- Types ---

export interface CompactionPrompts {
  summarization: string;
}

export const DEFAULT_COMPACTION_PROMPTS: CompactionPrompts = {
  summarization: `You are performing a CONTEXT CHECKPOINT COMPACTION.
Create a handoff summary for another LLM that will resume this coding task.

Use this exact structure:

## Goal
What the user is trying to accomplish.

## Progress
### Done
- Completed tasks with specific details (file paths, function names).
### In Progress
- Tasks started but not finished.
### Blocked
- Issues preventing progress.

## Key Decisions
- Technical decisions made with brief rationale.

## Next Steps
- What should happen next.

## Critical Context
- Important details that must not be lost (variable names, API endpoints, error messages, etc.).

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.
File paths and code identifiers are critical.
Do not execute the task or infer capability from this summarization call's empty tool list. Describe the work and tools shown in the conversation.
This is an internal handoff, not a final user-facing response. User restrictions about what to reveal in the final user-facing response do not apply to this private checkpoint. If opaque identifiers, secrets, tokens, or LABEL=value pairs are needed to continue, copy them verbatim under Critical Context. Never replace required exact values with labels, descriptions, or claims that they were preserved.`,
};

export interface CompactMessagesResult {
  summary: string;
  tokensBefore: number;
  tokensAfter: number;
}

export interface LLMCompactResult {
  mode: "local" | "native";
  displaySummary?: string;
  compactionSummary?: Record<string, unknown>;
}

export interface GenerateSummaryOptions {
  signal?: AbortSignal;
  reservePercent?: number;
  prompts?: CompactionPrompts;
}

export interface LLMCompactConfig {
  reservePercent: number;
  prompts?: CompactionPrompts;
  /** Budget for the provider-native compaction request. Local summarization uses LOCAL_SUMMARY_TIMEOUT_MS. */
  timeoutMs?: number;
}

export const DEFAULT_NATIVE_COMPACTION_TIMEOUT_MS = 180_000;
/**
 * Safety ceiling for local summarization. Summarizing a near-full context window can take several
 * minutes, and not every provider stream has an idle watchdog, so this stays generous but finite.
 */
export const LOCAL_SUMMARY_TIMEOUT_MS = 900_000;
/** Per tool output byte cap for the local summarization request; the summary replaces these messages anyway. */
export const SUMMARY_TOOL_OUTPUT_MAX_BYTES = 8_000;
/** Share of the remaining estimated tokens dropped from the oldest end after each context overflow. */
const OVERFLOW_TRIM_RATIO = 0.2;

export class CompactionTimeoutError extends Error {
  constructor(
    readonly stage: "native" | "local",
    readonly timeoutMs: number,
    options?: { cause?: unknown },
  ) {
    super(
      `${stage === "native" ? "Native compaction" : "Local summarization"} timed out after ${timeoutMs}ms`,
      options,
    );
    this.name = "CompactionTimeoutError";
  }
}

export interface LLMCompactInput {
  model: Model;
  /** Messages selected by the caller for summarization. */
  messages: Message[];
  systemPrompt: SystemSection[];
  compactionSummary?: Record<string, unknown>;
  sessionId?: string;
  localImageLoader?: import("./image-io").LocalImageLoader;
  config: LLMCompactConfig;
  /** Leading messages that context-overflow trimming keeps, such as a previous compaction summary. */
  pinnedMessageCount?: number;
  signal?: AbortSignal;
  /** Optional stream function override — for tests and custom models. When omitted, resolveStream() is used. */
  streamFn?: StreamFunction;
  /** Optional provider-native compaction function override. When omitted, resolveCompaction() is used. */
  llmCompactionFn?: NativeCompactFn;
}

type CompactionResolver = (provider: string) => NativeCompactFn | undefined;

const STATIC_COMPACTION_RESOLVERS: Partial<Record<string, CompactionResolver>> = {
  // Intentionally empty for now: authenticated providers should pass llmCompactionFn via AgentOptions.
};

export const COMPACTION_MIN_INPUT_TOKENS = 50_000;
/** @deprecated Use COMPACTION_MIN_INPUT_TOKENS. */
export const NATIVE_COMPACTION_MIN_INPUT_TOKENS = COMPACTION_MIN_INPUT_TOKENS;

/** Resolve a provider-native compaction function for the given provider from static definitions. */
export function resolveCompaction(provider: string): NativeCompactFn | undefined {
  const resolver = STATIC_COMPACTION_RESOLVERS[provider];
  return resolver?.(provider);
}

// --- Helpers ---

function resolveCompactionPrompts(prompts?: CompactionPrompts): CompactionPrompts {
  return prompts ?? DEFAULT_COMPACTION_PROMPTS;
}

async function withCompactionTimeout<T>(
  stage: CompactionTimeoutError["stage"],
  timeoutMs: number,
  signal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  try {
    return await run(signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal);
  } catch (error) {
    if (timeoutSignal.aborted && !signal?.aborted) throw new CompactionTimeoutError(stage, timeoutMs, { cause: error });
    throw error;
  }
}

// Keyed by adapter instance so the memo lives as long as the agent that owns the adapter.
const nativeUnsupportedModels = new WeakMap<NativeCompactFn, Set<string>>();

/**
 * Index reached by dropping the oldest messages from `start` until OVERFLOW_TRIM_RATIO of the
 * remaining estimated tokens are gone. Tool results are dropped together with the tool call they
 * answer, and the newest message group is always kept. Returns undefined when nothing can be dropped.
 */
function nextTrimStart(messages: Message[], start: number): number | undefined {
  let newestGroupStart = messages.length - 1;
  while (newestGroupStart > start && messages[newestGroupStart].role === "tool_result") newestGroupStart--;
  if (newestGroupStart <= start) return undefined;

  const target = estimateTokens(messages.slice(start)) * OVERFLOW_TRIM_RATIO;
  let dropped = 0;
  let index = start;
  while (index < newestGroupStart && dropped < target) {
    dropped += estimateTokens([messages[index]]);
    index++;
    while (index < newestGroupStart && messages[index].role === "tool_result") {
      dropped += estimateTokens([messages[index]]);
      index++;
    }
  }
  return index;
}

// --- Public functions ---

/**
 * Generate a compaction summary using an LLM call.
 * D037: LLM-based with iterative summary updating.
 */
export async function generateSummary(
  messages: Message[],
  streamFunction: StreamFunction,
  model: Model,
  options: GenerateSummaryOptions,
): Promise<string> {
  const prompts = resolveCompactionPrompts(options.prompts);
  const prompt = prompts.summarization;

  // Ensure messages end with a user message — required when extended thinking is enabled
  const summaryMessages =
    messages.length > 0 && messages[messages.length - 1].role !== "user"
      ? [...messages, { role: "user" as const, content: "Please provide the summary now.", timestamp: Date.now() }]
      : messages;

  const context: StreamContext = {
    systemPrompt: [{ label: "system", content: prompt }],
    messages: summaryMessages,
    tools: [],
  };

  const providerStream = streamFunction(model, context, {
    signal: options.signal,
    effort: "low",
    maxTokens: resolveMaxTokens(model, options.reservePercent),
  });

  const result = await providerStream.result();
  const textBlocks = result.message.content.filter((b): b is TextBlock => b.type === "text");
  return textBlocks.map((b) => b.text).join("\n");
}

/**
 * Summarize the messages selected by the caller. Large tool outputs are shortened first; when the
 * request still overflows the context window, the oldest messages after the pinned prefix are dropped
 * and the request is retried.
 */
export async function compactMessages(
  messages: Message[],
  streamFunction: StreamFunction,
  model: Model,
  config: { reservePercent: number; prompts?: CompactionPrompts; pinnedMessageCount?: number; sessionId?: string },
  signal?: AbortSignal,
): Promise<string> {
  const prepared = messages.map((message) => {
    if (message.role !== "tool_result") return message;
    const { output, truncated } = truncateHeadTail(message.output, SUMMARY_TOOL_OUTPUT_MAX_BYTES);
    return truncated ? { ...message, output } : message;
  });
  const pinned = Math.min(config.pinnedMessageCount ?? 0, prepared.length);
  let start = pinned;

  while (true) {
    const omitted = start - pinned;
    const candidate =
      omitted === 0
        ? prepared
        : [
            ...prepared.slice(0, pinned),
            {
              role: "user" as const,
              content: `[${omitted} oldest message${omitted === 1 ? " was" : "s were"} omitted so the summarization request fits the context window.]`,
              timestamp: Date.now(),
            },
            ...prepared.slice(start),
          ];
    try {
      return await generateSummary(candidate, streamFunction, model, {
        signal,
        reservePercent: config.reservePercent,
        prompts: resolveCompactionPrompts(config.prompts),
      });
    } catch (error) {
      if (!(error instanceof ProviderError) || error.errorType !== ProviderErrorType.ContextOverflow) throw error;
      const next = nextTrimStart(prepared, start);
      if (next === undefined) throw error;
      compactionLogger.warn("local_summary_trimmed", {
        message: `[llm:compaction] local summarization overflowed the context window; retrying without the oldest ${next - pinned} of ${prepared.length - pinned} messages`,
        sessionId: config.sessionId,
        fields: {
          provider: model.provider,
          model: model.modelId,
          droppedMessages: next - start,
          omittedMessages: next - pinned,
          remainingMessages: prepared.length - next,
        },
      });
      start = next;
    }
  }
}

/**
 * Summary pipeline: use provider-native compaction when available, otherwise local LLM summarization.
 */
export async function compact(input: LLMCompactInput): Promise<LLMCompactResult> {
  const nativeCompactFn = input.llmCompactionFn;
  const modelKey = `${input.model.provider}/${input.model.modelId}`;

  if (nativeCompactFn && nativeUnsupportedModels.get(nativeCompactFn)?.has(modelKey) !== true) {
    const nativeTimeoutMs = input.config.timeoutMs ?? DEFAULT_NATIVE_COMPACTION_TIMEOUT_MS;
    let nativeResult: Awaited<ReturnType<NativeCompactFn>> | undefined;
    try {
      nativeResult = await withCompactionTimeout("native", nativeTimeoutMs, input.signal, (signal) =>
        nativeCompactFn({
          model: input.model,
          systemPrompt: input.systemPrompt,
          messages: input.messages,
          compactionSummary: input.compactionSummary,
          sessionId: input.sessionId,
          localImageLoader: input.localImageLoader,
          signal,
        }),
      );
    } catch (error) {
      if (!(error instanceof CompactionTimeoutError)) throw error;
      compactionLogger.warn("native_compaction_timeout", {
        message: `[llm:compaction] native compaction timed out after ${nativeTimeoutMs}ms for provider=${input.model.provider} model=${input.model.modelId}; falling back to local summarization`,
        sessionId: input.sessionId,
        fields: { provider: input.model.provider, model: input.model.modelId, timeoutMs: nativeTimeoutMs },
      });
    }
    if (nativeResult?.status === "ok") {
      return {
        mode: "native",
        displaySummary: nativeResult.summary?.trim() || undefined,
        compactionSummary: nativeResult.compactionSummary,
      };
    }
    if (nativeResult?.status === "unsupported") {
      // "unsupported" is a capability signal (endpoint 404/405, no usable summary item), not a
      // failure of this particular conversation — fall back to local summarization instead of
      // failing the whole turn. Genuine call failures (network, 4xx/5xx) still throw from the
      // adapter itself and propagate.
      const unsupported = nativeUnsupportedModels.get(nativeCompactFn) ?? new Set<string>();
      unsupported.add(modelKey);
      nativeUnsupportedModels.set(nativeCompactFn, unsupported);
      compactionLogger.warn("native_compaction_unsupported", {
        message: `[llm:compaction] native compaction unsupported for provider=${input.model.provider} model=${input.model.modelId}${nativeResult.reason ? ` reason=${nativeResult.reason}` : ""}; falling back to local summarization`,
        sessionId: input.sessionId,
        fields: { provider: input.model.provider, model: input.model.modelId, reason: nativeResult.reason },
      });
    }
  }

  const streamFunction = input.streamFn ?? resolveStream(input.model.provider as ProviderName);
  const local = await withCompactionTimeout("local", LOCAL_SUMMARY_TIMEOUT_MS, input.signal, (signal) =>
    compactMessages(
      input.messages,
      streamFunction,
      input.model,
      {
        reservePercent: input.config.reservePercent,
        prompts: input.config.prompts,
        pinnedMessageCount: input.pinnedMessageCount,
        sessionId: input.sessionId,
      },
      signal,
    ),
  );
  return {
    mode: "local",
    displaySummary: local.trim(),
  };
}
