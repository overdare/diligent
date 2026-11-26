// @summary Scripted provider streams and context readers for assembled runtime eval tests

import { EventStream } from "@diligent/core/event-stream";
import type { AssistantMessage, Message } from "@diligent/core/message-contract";
import type {
  ProviderEvent,
  ProviderManager,
  ProviderResult,
  StreamContext,
  StreamFunction,
} from "@diligent/core/provider-contract";
import { runRuntimeEvalExecution } from "../../src/runner/runtime-execution";
import type { AnyRuntimeEvalTask, RuntimeEvalExecutionResult } from "../../src/runtime-task";
import type { EvalProfile } from "../../src/task";
import { assistantMessage, sequenceStream } from "./fake-stream";

export const OPENAI_PROFILE: EvalProfile = { provider: "openai", model: "gpt-6.1-terra", effort: "medium" };
export const CHATGPT_PROFILE: EvalProfile = { provider: "chatgpt", model: "gpt-6.1-terra", effort: "medium" };

export type Responder = (call: number, context: StreamContext) => ReturnType<StreamFunction> | AssistantMessage;

/** Runs a task through the assembled runtime with a stream that answers each provider call from `respond`. */
export function runScripted(
  task: AnyRuntimeEvalTask,
  respond: Responder,
  options: {
    seed?: string;
    profile?: EvalProfile;
    configureProviderManager?: (profile: EvalProfile, manager: ProviderManager) => void;
  } = {},
): Promise<RuntimeEvalExecutionResult> {
  let call = 0;
  return runRuntimeEvalExecution({
    task,
    profile: options.profile ?? OPENAI_PROFILE,
    seed: options.seed ?? "scripted-seed",
    streamFunction: (model, context, streamOptions) => {
      const response = respond(++call, context);
      return "role" in response ? sequenceStream([response])(model, context, streamOptions) : response;
    },
    configureProviderManager: options.configureProviderManager,
  });
}

export function text(value: string): AssistantMessage {
  return assistantMessage([{ type: "text", text: value }]);
}

export function lastUserText(context: StreamContext): string {
  const message = [...context.messages]
    .reverse()
    .find((item): item is Extract<Message, { role: "user" }> => item.role === "user");
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

export function collectBase64Images(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectBase64Images);
  if (!value || typeof value !== "object") return [];
  const entries = Object.entries(value);
  const own = entries.some(([key, item]) => key === "type" && item === "base64")
    ? entries.flatMap(([key, item]) => (key === "data" && typeof item === "string" ? [item] : []))
    : [];
  return [...own, ...entries.flatMap(([, item]) => collectBase64Images(item))];
}

/** Streams one assistant message whose text arrives in the given chunks, after `ready` settles. */
export function splitTextStream(
  message: AssistantMessage,
  chunks: string[],
  ready: Promise<unknown> = Promise.resolve(),
): ReturnType<StreamFunction> {
  const stream = new EventStream<ProviderEvent, ProviderResult>(
    (event) => event.type === "done" || event.type === "error",
    (event) => {
      if (event.type === "done") return { message: event.message };
      throw (event as { type: "error"; error: Error }).error;
    },
  );
  void ready.then(() => {
    stream.push({ type: "start" });
    for (const chunk of chunks) stream.push({ type: "text_delta", delta: chunk });
    for (const block of message.content) {
      if (block.type !== "tool_call") continue;
      stream.push({ type: "tool_call_start", id: block.id, name: block.name });
      stream.push({ type: "tool_call_end", id: block.id, name: block.name, input: block.input });
    }
    stream.push({ type: "done", stopReason: message.stopReason, message });
  });
  return stream;
}
