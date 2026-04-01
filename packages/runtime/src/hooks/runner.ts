// @summary Executes UserPromptSubmit and Stop lifecycle hooks as shell commands or plugin functions

import type { AssistantMessage, Message } from "@diligent/core/types";
import type { DiligentConfig } from "../config/schema";

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

type HookHandler = NonNullable<NonNullable<DiligentConfig["hooks"]>["UserPromptSubmit"]>[number];

export interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  [key: string]: unknown;
}

export interface HookResult {
  blocked: boolean;
  /** Reason shown to user / sent back to Claude when blocked */
  reason?: string;
  /** Plain text or additionalContext field to prepend to the conversation */
  additionalContext?: string;
}

const DEFAULT_TIMEOUT_SECONDS = 60;

async function runSingleHook(handler: HookHandler, input: HookInput, cwd: string): Promise<HookResult> {
  const timeoutMs = (handler.timeout ?? DEFAULT_TIMEOUT_SECONDS) * 1_000;
  const inputJson = JSON.stringify(input);

  const proc = Bun.spawn(["bash", "-c", handler.command], {
    cwd,
    stdin: Buffer.from(inputJson),
    stdout: "pipe",
    stderr: "pipe",
    env: process.env as Record<string, string>,
  });

  const timeoutHandle = setTimeout(() => proc.kill(), timeoutMs);

  let exitCode: number;
  let stdoutText: string;
  let stderrText: string;

  try {
    [exitCode, stdoutText, stderrText] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
  } finally {
    clearTimeout(timeoutHandle);
  }

  // Exit 2: blocking error — stderr is the reason
  if (exitCode === 2) {
    return {
      blocked: true,
      reason: stderrText.trim() || "Hook blocked the operation",
    };
  }

  // Non-zero (other than 2): non-blocking error — ignore and continue
  if (exitCode !== 0) {
    return { blocked: false };
  }

  // Exit 0: parse JSON stdout for structured decisions
  const trimmed = stdoutText.trim();
  if (!trimmed) return { blocked: false };

  // Plain text (non-JSON) → additional context
  if (!trimmed.startsWith("{")) {
    return { blocked: false, additionalContext: trimmed };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return { blocked: false };
  }

  const blocked = parsed.decision === "block";
  const reason = typeof parsed.reason === "string" ? parsed.reason : undefined;

  // additionalContext: top-level or nested in hookSpecificOutput
  const hookSpecific = parsed.hookSpecificOutput as Record<string, unknown> | undefined;
  const additionalContext =
    typeof parsed.additionalContext === "string"
      ? parsed.additionalContext
      : typeof hookSpecific?.additionalContext === "string"
        ? hookSpecific.additionalContext
        : undefined;

  return { blocked, reason, additionalContext };
}

/** Plugin-provided hook handler function. */
export type PluginHookFn = (input: HookInput) => Promise<Partial<HookResult>>;

/** Run plugin hook handlers sequentially; stop and return on first block. Errors are non-blocking. */
export async function runPluginHooks(handlers: PluginHookFn[], input: HookInput): Promise<HookResult> {
  let combinedContext: string | undefined;
  for (const handler of handlers) {
    let result: Partial<HookResult>;
    try {
      result = await handler(input);
    } catch {
      continue;
    }
    if (result.blocked) return { blocked: true, reason: result.reason };
    if (result.additionalContext) {
      combinedContext = combinedContext ? `${combinedContext}\n${result.additionalContext}` : result.additionalContext;
    }
  }
  return { blocked: false, additionalContext: combinedContext };
}

/** Run shell command handlers sequentially; stop and return on first block. */
export async function runHooks(handlers: HookHandler[], input: HookInput, cwd: string): Promise<HookResult> {
  let combinedContext: string | undefined;

  for (const handler of handlers) {
    const result = await runSingleHook(handler, input, cwd);
    if (result.blocked) return result;
    if (result.additionalContext) {
      combinedContext = combinedContext ? `${combinedContext}\n${result.additionalContext}` : result.additionalContext;
    }
  }

  return { blocked: false, additionalContext: combinedContext };
}

/** Aggregate token usage across all assistant messages in a context array. */
export function getSessionUsage(messages: Message[]): SessionUsage {
  const total: SessionUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const { usage } = msg as AssistantMessage;
    total.inputTokens += usage.inputTokens;
    total.outputTokens += usage.outputTokens;
    total.cacheReadTokens += usage.cacheReadTokens;
    total.cacheWriteTokens += usage.cacheWriteTokens;
  }
  return total;
}

/** Extract the text content of the last assistant message from a context array. */
export function getLastAssistantMessage(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const { content } = msg;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
    }
  }
  return "";
}
