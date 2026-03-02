// @summary ChatGPT subscription stream — raw fetch to chatgpt.com/backend-api/codex/responses (no SDK)
import { platform, release, arch } from "node:os";
import type { OpenAIOAuthTokens } from "../auth/types";
import { EventStream } from "../event-stream";
import { isNetworkError } from "./errors";
import type { AssistantMessage, ContentBlock, Message, StopReason, Usage } from "../types";
import type {
  Model,
  ProviderEvent,
  ProviderResult,
  StreamContext,
  StreamFunction,
  StreamOptions,
  ToolDefinition,
} from "./types";
import { ProviderError } from "./types";

const CHATGPT_CODEX_URL = "https://chatgpt.com/backend-api/codex/responses";
const USER_AGENT = `diligent/0.0.1 (${platform()} ${release()}; ${arch()})`;

/**
 * Create a StreamFunction for ChatGPT subscription (OAuth).
 *
 * Bypasses the OpenAI Node SDK entirely — makes raw fetch calls to
 * chatgpt.com/backend-api/codex/responses using the Responses API format.
 * This avoids SDK-specific headers that the ChatGPT endpoint rejects.
 *
 * @param getTokens - Called per-request to get the current (possibly refreshed) tokens
 */
export function createChatGPTStream(getTokens: () => OpenAIOAuthTokens): StreamFunction {
  return (model: Model, context: StreamContext, options: StreamOptions): EventStream<ProviderEvent, ProviderResult> => {
    const stream = new EventStream<ProviderEvent, ProviderResult>(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") return { message: event.message };
        throw (event as { type: "error"; error: Error }).error;
      },
    );

    (async () => {
      try {
        const tokens = getTokens();

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${tokens.access_token}`,
          "User-Agent": USER_AGENT,
          originator: "diligent",
        };
        if (tokens.account_id) {
          headers["ChatGPT-Account-ID"] = tokens.account_id;
        }

        // Responses API format body
        const body: Record<string, unknown> = {
          model: model.id,
          stream: true,
          store: false,
        };
        if (context.systemPrompt) {
          body.instructions = context.systemPrompt;
        }
        body.input = buildInput(context.messages);
        if (context.tools.length > 0) {
          body.tools = buildTools(context.tools);
        }
        if (options.maxTokens !== undefined) {
          body.max_output_tokens = options.maxTokens;
        }

        const response = await fetch(CHATGPT_CODEX_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: options.signal,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          throw new ProviderError(
            `ChatGPT API error (${response.status}): ${errText || "no body"}`,
            response.status === 429 ? "rate_limit" : response.status === 401 || response.status === 403 ? "auth" : "unknown",
            response.status === 429,
            undefined,
            response.status,
          );
        }

        stream.push({ type: "start" });

        // Parse SSE from response body
        const contentBlocks: ContentBlock[] = [];
        let currentText = "";
        let stopReason: StopReason = "end_turn";
        let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
        const toolBuffers = new Map<string, { id: string; name: string; args: string }>();

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          if (options.signal?.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop()!; // keep incomplete line

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (!data || data === "[DONE]") continue;

            let event: Record<string, unknown>;
            try {
              event = JSON.parse(data) as Record<string, unknown>;
            } catch {
              continue;
            }

            const type = event.type as string;

            switch (type) {
              case "response.output_text.delta": {
                const delta = event.delta as string;
                if (delta) {
                  currentText += delta;
                  stream.push({ type: "text_delta", delta });
                }
                break;
              }

              case "response.output_item.added": {
                const item = event.item as Record<string, unknown>;
                if (item?.type === "function_call") {
                  const id = item.call_id as string;
                  const name = item.name as string;
                  toolBuffers.set(id, { id, name, args: "" });
                  stream.push({ type: "tool_call_start", id, name });
                }
                break;
              }

              case "response.function_call_arguments.delta": {
                const delta = event.delta as string;
                const itemId = event.item_id as string;
                if (delta && itemId) {
                  const buf = toolBuffers.get(itemId);
                  if (buf) {
                    buf.args += delta;
                    stream.push({ type: "tool_call_delta", id: buf.id, delta });
                  }
                }
                break;
              }

              case "response.output_item.done": {
                const item = event.item as Record<string, unknown>;
                if (item?.type === "message") {
                  const content = item.content as Array<Record<string, unknown>>;
                  if (content) {
                    for (const part of content) {
                      if (part.type === "output_text") {
                        const text = part.text as string;
                        stream.push({ type: "text_end", text });
                        contentBlocks.push({ type: "text", text });
                        currentText = "";
                      }
                    }
                  }
                } else if (item?.type === "function_call") {
                  const id = (item.call_id as string) ?? "";
                  const name = (item.name as string) ?? "";
                  const argsStr = (item.arguments as string) ?? "";
                  let input: Record<string, unknown>;
                  try {
                    input = JSON.parse(argsStr) as Record<string, unknown>;
                  } catch {
                    input = {};
                  }
                  stream.push({ type: "tool_call_end", id, name, input });
                  contentBlocks.push({ type: "tool_call", id, name, input });
                  toolBuffers.delete(id);
                }
                break;
              }

              case "response.completed": {
                const resp = event.response as Record<string, unknown>;
                if (resp) {
                  const u = resp.usage as Record<string, number> | undefined;
                  if (u) {
                    usage = {
                      inputTokens: u.input_tokens ?? 0,
                      outputTokens: u.output_tokens ?? 0,
                      cacheReadTokens: 0,
                      cacheWriteTokens: 0,
                    };
                  }
                  stopReason = mapStopReason(resp.status as string);
                }
                break;
              }

              case "response.failed": {
                const resp = event.response as Record<string, unknown>;
                const respError = resp?.error as Record<string, unknown> | undefined;
                const msg = (respError?.message as string) ?? "ChatGPT response failed";
                stream.push({ type: "error", error: new ProviderError(msg, "unknown", false) });
                return;
              }
            }
          }
        }

        // Flush any remaining text that wasn't closed by output_item.done
        if (currentText) {
          stream.push({ type: "text_end", text: currentText });
          contentBlocks.push({ type: "text", text: currentText });
        }

        stream.push({ type: "usage", usage });

        const assistantMessage: AssistantMessage = {
          role: "assistant",
          content: contentBlocks,
          model: model.id,
          usage,
          stopReason,
          timestamp: Date.now(),
        };

        stream.push({ type: "done", stopReason, message: assistantMessage });
      } catch (err) {
        if (err instanceof ProviderError) {
          stream.push({ type: "error", error: err });
        } else if (isNetworkError(err)) {
          stream.push({ type: "error", error: new ProviderError(String(err), "network", true) });
        } else {
          stream.push({
            type: "error",
            error: new ProviderError(
              err instanceof Error ? err.message : String(err),
              "unknown",
              false,
              undefined,
              undefined,
              err instanceof Error ? err : undefined,
            ),
          });
        }
      }
    })();

    return stream;
  };
}

// Responses API input format
type InputItem =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

function buildInput(messages: Message[]): InputItem[] {
  const result: InputItem[] = [];

  for (const msg of messages) {
    if (msg.role === "user") {
      result.push({
        role: "user",
        content:
          typeof msg.content === "string"
            ? msg.content
            : msg.content
                .filter((b) => b.type === "text")
                .map((b) => (b as { type: "text"; text: string }).text)
                .join("\n"),
      });
    } else if (msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type === "text") {
          result.push({ role: "assistant", content: block.text });
        } else if (block.type === "tool_call") {
          result.push({
            type: "function_call",
            call_id: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input),
          });
        }
      }
    } else if (msg.role === "tool_result") {
      result.push({
        type: "function_call_output",
        call_id: msg.toolCallId,
        output: msg.output,
      });
    }
  }

  return result;
}

function buildTools(tools: ToolDefinition[]): Array<{
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> {
  return tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: { type: "object", ...t.inputSchema },
  }));
}

function mapStopReason(status: string | undefined): StopReason {
  switch (status) {
    case "completed":
      return "end_turn";
    case "incomplete":
      return "max_tokens";
    case "failed":
      return "error";
    case "cancelled":
      return "aborted";
    default:
      return "end_turn";
  }
}
