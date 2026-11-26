// @summary Assembled-runtime grading for provider-native web search grounding

import { describe, expect, test } from "bun:test";
import type { AssistantMessage } from "@diligent/core/message-contract";
import {
  extractUrlHosts,
  webResultHosts,
  webSearchGroundingTask,
} from "../../../src/tasks/runtime/web-search-grounding";
import { assistantMessage } from "../../helpers/fake-stream";
import { runScripted, text } from "../../helpers/scripted-runtime";

describe("web-search-grounding", () => {
  test("advertises the provider-native web tool and passes an answer grounded in the results", async () => {
    const result = await runScripted(webSearchGroundingTask, () =>
      webAnswer("See https://bun.sh/docs/api/http.", [{ url: "https://bun.sh/docs/api/http", title: "HTTP server" }]),
    );
    expect(result.failures).toEqual([]);
    expect(result.execution.providerCalls[0]!.tools.items).toContainEqual(
      expect.objectContaining({ kind: "provider_builtin", capability: "web" }),
    );
  });

  test("fails without a native search and when the cited host is absent from the results", async () => {
    const unsearched = await runScripted(webSearchGroundingTask, () => text("https://bun.sh/docs/api/http"));
    expect(unsearched.failure).toMatchObject({ code: "task_semantic.web_search_grounding.not_searched" });

    const ungrounded = await runScripted(webSearchGroundingTask, () =>
      webAnswer("https://example.com/bun", [{ url: "https://bun.sh/docs/api/http" }]),
    );
    expect(ungrounded.failure).toMatchObject({ code: "task_semantic.web_search_grounding.ungrounded" });
  });

  test("accepts a bare-domain title for providers that return redirect URLs", () => {
    const hosts = webResultHosts([{ url: "https://vertexaisearch.cloud.google.com/grounding/abc", title: "bun.sh" }]);
    expect(extractUrlHosts("Source: https://www.bun.sh/docs/api/http.").some((host) => hosts.has(host))).toBe(true);
  });
});

function webAnswer(answer: string, results: { url: string; title?: string }[]): AssistantMessage {
  return assistantMessage([
    { type: "provider_tool_use", id: "search", provider: "openai", name: "web_search", input: { query: "Bun.serve" } },
    { type: "web_search_result", toolUseId: "search", provider: "openai", results },
    { type: "text", text: answer },
  ]);
}
