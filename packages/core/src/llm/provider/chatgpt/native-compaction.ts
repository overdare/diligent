// @summary ChatGPT native compaction through a Responses stream with a compaction trigger
import { arch, platform, release } from "node:os";
import type { OpenAIOAuthTokens } from "../../../auth/types";
import { flattenSections } from "../../system-sections";
import type { NativeCompactFn } from "../native-compaction";
import { readOpenAIFamilyCompactError } from "../openai/compact-errors";
import { buildResponsesRequestBody, toResponsesLiteRequestBody, usesResponsesLite } from "../openai/responses";
import { classifyOpenAIFamilyError, extractOpenAICompactionState, parseOpenAIRetryAfter } from "../openai/shared";
import { CHATGPT_CODEX_CLIENT_VERSION, CHATGPT_SESSION_HEADER } from "./headers";
import { iterateChatGPTJsonSse } from "./http-sse";

const CHATGPT_RESPONSES_URL = "https://chatgpt.com/backend-api/codex/responses";
const RESPONSES_LITE_HEADER = "x-openai-internal-codex-responses-lite";
const CHATGPT_JSON_CONTENT_TYPE = "application/json";
const USER_AGENT = `diligent (${platform()} ${release()}; ${arch()})`;

export function createChatGPTNativeCompaction(getTokens: () => OpenAIOAuthTokens): NativeCompactFn {
  return async (input) => {
    input.signal?.throwIfAborted();
    const tokens = getTokens();
    const upstreamModelId = input.model.modelId;
    const useResponsesLite = usesResponsesLite(upstreamModelId);
    const headers: Record<string, string> = {
      "Content-Type": CHATGPT_JSON_CONTENT_TYPE,
      Accept: "text/event-stream",
      Authorization: `Bearer ${tokens.access_token}`,
      "User-Agent": USER_AGENT,
      originator: "diligent",
      version: CHATGPT_CODEX_CLIENT_VERSION,
    };
    if (tokens.account_id) headers["ChatGPT-Account-ID"] = tokens.account_id;
    if (input.sessionId) headers[CHATGPT_SESSION_HEADER] = input.sessionId;
    if (useResponsesLite) headers[RESPONSES_LITE_HEADER] = "true";

    const standardBody = await buildResponsesRequestBody({
      model: upstreamModelId,
      messages: input.messages,
      compactionSummary: input.compactionSummary,
      localImageLoader: input.localImageLoader,
      systemInstructions: flattenSections(input.systemPrompt),
      sessionId: input.sessionId,
      store: false,
      provider: "chatgpt",
    });
    standardBody.input = [...(standardBody.input as unknown[]), { type: "compaction_trigger" }];
    const body = useResponsesLite ? toResponsesLiteRequestBody(standardBody) : standardBody;

    const response = await fetch(CHATGPT_RESPONSES_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: input.signal,
    });

    if (!response.ok) {
      const errorBody = await readOpenAIFamilyCompactError(response, ["code", "type", "message"]);
      const message = `ChatGPT native compaction failed (${response.status})${errorBody.formatted ? ` body=${errorBody.formatted}` : ""}`;
      throw classifyOpenAIFamilyError({
        message,
        status: response.status,
        code: errorBody.code,
        cause: Object.assign(new Error(errorBody.message ?? message), { code: errorBody.code }),
        retryAfterMs: parseOpenAIRetryAfter(response.headers),
      });
    }

    const checkpoints: Record<string, unknown>[] = [];
    let completed = false;
    for await (const event of iterateChatGPTJsonSse(response.body, { signal: input.signal })) {
      if (event.type === "response.output_item.done") {
        const item = event.item as Record<string, unknown> | undefined;
        if (item?.type === "compaction" || item?.type === "compaction_summary") checkpoints.push(item);
      } else if (event.type === "response.completed") {
        completed = true;
        break;
      } else if (event.type === "response.failed" || event.type === "error") {
        const failedResponse = event.response as Record<string, unknown> | undefined;
        const rawError = event.type === "response.failed" ? failedResponse?.error : event.error;
        const error = rawError && typeof rawError === "object" ? (rawError as Record<string, unknown>) : undefined;
        const code = error?.code ?? event.code;
        const message =
          error?.message ?? event.message ?? (typeof rawError === "string" ? rawError : "Response failed");
        throw classifyOpenAIFamilyError({
          message: `ChatGPT native compaction failed: ${message}`,
          code: typeof code === "string" ? code : undefined,
        });
      } else if (event.type === "response.incomplete") {
        const incomplete = event.response as { incomplete_details?: { reason?: string } } | undefined;
        throw new Error(`ChatGPT native compaction incomplete: ${incomplete?.incomplete_details?.reason ?? "unknown"}`);
      }
    }
    input.signal?.throwIfAborted();
    if (!completed) throw new Error("ChatGPT native compaction stream closed before response.completed");
    if (checkpoints.length !== 1)
      throw new Error(
        `ChatGPT native compaction expected exactly one compaction output item, got ${checkpoints.length}`,
      );
    if (typeof checkpoints[0].encrypted_content !== "string" || !checkpoints[0].encrypted_content.trim())
      throw new Error("ChatGPT native compaction returned an empty encrypted checkpoint");

    const compactionSummary = extractOpenAICompactionState({ output: checkpoints });
    return { status: "ok", compactionSummary };
  };
}
