// @summary ChatGPT subscription stream — raw fetch to chatgpt.com/backend-api/codex/responses (no SDK)
import { arch, platform, release } from "node:os";
import { DILIGENT_VERSION } from "@diligent/protocol";
import type { OpenAIOAuthTokens } from "../auth/types";
import { EventStream } from "../event-stream";
import { isNetworkError } from "./errors";
import { buildTools, convertMessages, handleResponsesAPIEvents } from "./openai-shared";
import { flattenSections } from "./system-sections";
import type { Model, ProviderEvent, ProviderResult, StreamContext, StreamFunction, StreamOptions } from "./types";
import { ProviderError } from "./types";

const CHATGPT_CODEX_URL = "https://chatgpt.com/backend-api/codex/responses";
const USER_AGENT = `diligent/${DILIGENT_VERSION} (${platform()} ${release()}; ${arch()})`;

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

        const effort = options.effort ?? "medium";
        const useReasoning = model.supportsThinking && (options.budgetTokens ?? model.defaultBudgetTokens);

        // Responses API format body
        const body: Record<string, unknown> = {
          model: model.id,
          stream: true,
          store: false,
        };
        if (context.systemPrompt.length > 0) {
          body.instructions = flattenSections(context.systemPrompt);
        }
        body.input = await convertMessages(context.messages);
        if (context.tools.length > 0) {
          body.tools = buildTools(context.tools);
        }
        if (options.maxTokens !== undefined) {
          body.max_output_tokens = options.maxTokens;
        }
        if (useReasoning) {
          body.reasoning = { effort: effort === "max" ? "high" : effort, summary: "auto" };
          body.include = ["reasoning.encrypted_content"];
        }

        const response = await fetch(CHATGPT_CODEX_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: options.signal,
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          const isUsageLimit = errText.includes("usage_limit_reached");
          const is429 = response.status === 429;
          throw new ProviderError(
            `ChatGPT API error (${response.status}): ${errText || "no body"}`,
            is429 && isUsageLimit
              ? "unknown"
              : is429
                ? "rate_limit"
                : response.status === 401 || response.status === 403
                  ? "auth"
                  : "unknown",
            is429 && !isUsageLimit,
            undefined,
            response.status,
          );
        }

        stream.push({ type: "start" });

        // Parse SSE lines into an async iterable of event objects
        async function* parseSse(): AsyncIterable<Record<string, unknown>> {
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
              yield event;
            }
          }
        }

        await handleResponsesAPIEvents(parseSse(), stream, model, options.signal);
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
