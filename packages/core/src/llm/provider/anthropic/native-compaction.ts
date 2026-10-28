// @summary Anthropic native compaction request and response handling
import type { NativeCompactFn } from "../native-compaction";
import { ANTHROPIC_FILES_BETA, getAnthropicImageFiles, isFileSourceRejection } from "./image-files";
import { convertMessages, ensureAnthropicCompactionConversationEndsWithUser } from "./messages";
import { toAnthropicBlocks } from "./request";

function resolveAnthropicBaseUrl(baseUrl?: string): string {
  const resolved = (baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
  return resolved.endsWith("/v1") ? resolved : `${resolved}/v1`;
}

function extractAnthropicCompactionSummary(content: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const rawBlock of content) {
    if (!isRecord(rawBlock) || rawBlock.type !== "compaction") continue;
    if (typeof rawBlock.content !== "string" || !rawBlock.content.trim()) continue;
    const block: Record<string, unknown> = { type: "compaction", content: rawBlock.content };
    if (isRecord(rawBlock.cache_control)) block.cache_control = rawBlock.cache_control;
    return block;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createAnthropicNativeCompaction(apiKey: string, baseUrl?: string): NativeCompactFn {
  const baseUrlWithVersion = resolveAnthropicBaseUrl(baseUrl);
  const endpoint = `${baseUrlWithVersion}/messages`;
  const imageFiles = getAnthropicImageFiles(apiKey, baseUrlWithVersion);
  return async (input) => {
    const rawMessages = await convertMessages(input.messages, input.compactionSummary, input.localImageLoader);
    const normalizedMessages = ensureAnthropicCompactionConversationEndsWithUser(rawMessages);
    const referenced = imageFiles
      ? await imageFiles.reference(normalizedMessages)
      : { messages: normalizedMessages, usesFiles: false };
    const send = (messages: unknown[], usesFiles: boolean): Promise<Response> => {
      const body: Record<string, unknown> = {
        model: input.model.modelId,
        max_tokens: Math.max(256, Math.min(input.model.maxOutputTokens, 4_096)),
        messages,
        context_management: {
          edits: [
            {
              type: "compact_20260112",
              trigger: { type: "input_tokens", value: 50_000 },
              pause_after_compaction: true,
            },
          ],
        },
      };
      if (input.systemPrompt.length > 0) body.system = toAnthropicBlocks(input.systemPrompt);
      return fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": usesFiles ? `compact-2026-01-12,${ANTHROPIC_FILES_BETA}` : "compact-2026-01-12",
        },
        body: JSON.stringify(body),
        signal: input.signal,
      });
    };

    let response = await send(referenced.messages, referenced.usesFiles);
    if (imageFiles && referenced.usesFiles && isFileSourceRejection(response.status)) {
      const rejected = response;
      response = await send(normalizedMessages, false);
      // Only an inline success proves the file references caused the rejection.
      if (response.ok) imageFiles.disable((await readErrorBody(rejected)) ?? `status_${rejected.status}`);
    }

    if (!response.ok) {
      const errorDetails = await readErrorBody(response);
      if (response.status === 400 || response.status === 404 || response.status === 405 || response.status === 422) {
        return {
          status: "unsupported",
          reason: errorDetails ? `status_${response.status} ${errorDetails}` : `status_${response.status}`,
        };
      }
      throw new Error(
        errorDetails
          ? `Anthropic native compaction failed (${response.status}) ${errorDetails}`
          : `Anthropic native compaction failed (${response.status})`,
      );
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const compactionSummary = extractAnthropicCompactionSummary(payload.content);
    const summary = typeof compactionSummary?.content === "string" ? compactionSummary.content : undefined;
    const stopReason = typeof payload.stop_reason === "string" ? payload.stop_reason : undefined;
    const payloadKeys = Object.keys(payload).slice(0, 8).join(",") || "none";
    if (!summary?.trim() || !compactionSummary) {
      return {
        status: "unsupported",
        reason: `missing_compaction_block stop_reason=${stopReason ?? "-"} payload_keys=${payloadKeys}`,
      };
    }
    return { status: "ok", summary, compactionSummary };
  };
}

async function readErrorBody(response: Response): Promise<string | undefined> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const payload = (await response.json()) as Record<string, unknown>;
      return JSON.stringify(payload);
    } catch {
      return undefined;
    }
  }

  try {
    const text = (await response.text()).trim();
    return text || undefined;
  } catch {
    return undefined;
  }
}
