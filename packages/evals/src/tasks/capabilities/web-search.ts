// @summary Capability probe: provider-native web search returns results that the final answer cites

import type { ContentBlock } from "@diligent/core/message-contract";
import type { RuntimeEvalExecution, RuntimeEvalTask } from "../../runtime-task";
import { finalAssistantText, RuntimeGrade } from "../runtime/grading";
import { createFixtureRuntimeConfig, DEFAULT_RUNTIME_LIMITS, type RuntimeFixtureWorld } from "../runtime/helpers";

const WEB_TOOL = "web_action";
const URL_PATTERN = /https?:\/\/[^\s<>()[\]"'`]+/gi;
const HOST_PATTERN = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;

export type WebSearchCapabilityWorld = RuntimeFixtureWorld;

export interface WebSearchEvidence {
  searches: number;
  results: { url: string; title?: string }[];
  errors: string[];
}

export const webSearchCapabilityTask: RuntimeEvalTask<WebSearchCapabilityWorld> = {
  id: "capability-web-search",
  description: "Search the web with the provider-native tool and answer with a URL taken from the results.",
  fixtureVersion: "capability-web-search-v1",
  limits: { ...DEFAULT_RUNTIME_LIMITS, maxTurns: 3, maxToolCalls: 0, maxChangedFiles: 0, timeoutMs: 600_000 },
  toolPolicy: { allowedTools: [WEB_TOOL], allowedCapabilities: ["execute"], allowedCommands: [] },
  async setup(seed, root) {
    return { root, seed, expected: "", protectedPaths: [], allowedChanges: [] };
  },
  createRuntimeConfig: createFixtureRuntimeConfig,
  createSteps: () => [
    {
      kind: "turn",
      message: [
        "Use web search to find the official documentation page for the Bun runtime's Bun.serve HTTP server API.",
        "Answer only from the search results, not from memory.",
        "Reply with the full URL of the search result you relied on, copied exactly as it appears in the results.",
      ].join(" "),
    },
  ],
  snapshotWorld: async () => ({}),
  evaluate(input) {
    const grade = new RuntimeGrade("capability_web_search");
    const evidence = collectWebSearchEvidence(input);
    if (evidence.searches === 0)
      return grade.fail("not_searched", "The provider never issued a native web search.", "behavior");
    if (evidence.results.length === 0) {
      const detail = evidence.errors.length > 0 ? ` Errors: ${evidence.errors.join(", ")}.` : "";
      return grade.fail("no_results", `Native web search returned no results.${detail}`, "behavior");
    }
    const answerHosts = extractUrlHosts(finalAssistantText(input));
    if (answerHosts.length === 0) return grade.fail("no_source", "The final answer contained no URL.", "semantic_goal");
    const resultHosts = webResultHosts(evidence.results);
    if (!answerHosts.some((host) => resultHosts.has(host)))
      return grade.fail(
        "ungrounded",
        `The answer cited ${answerHosts.join(", ")}, none of which appeared in the search results.`,
        "semantic_goal",
      );
    return grade.pass();
  },
};

/** Provider-native search calls and result entries observed in the run's assistant messages. */
export function collectWebSearchEvidence(input: Pick<RuntimeEvalExecution<unknown>, "turns">): WebSearchEvidence {
  const blocks = input.turns.flatMap((turn) =>
    turn.messages.flatMap((message) => (message.role === "assistant" ? (message.content as ContentBlock[]) : [])),
  );
  const evidence: WebSearchEvidence = { searches: 0, results: [], errors: [] };
  for (const block of blocks) {
    if (block.type === "provider_tool_use" && block.name === "web_search") evidence.searches += 1;
    if (block.type !== "web_search_result") continue;
    if (block.error) evidence.errors.push(block.error.code);
    evidence.results.push(...block.results.map((result) => ({ url: result.url, title: result.title })));
  }
  return evidence;
}

/**
 * Hosts a cited URL can match. Some providers return redirect URLs and put the source domain in the title,
 * so a title that is itself a bare domain also counts.
 */
export function webResultHosts(results: readonly { url: string; title?: string }[]): Set<string> {
  const hosts = new Set<string>();
  for (const result of results) {
    const host = hostOf(result.url);
    if (host) hosts.add(host);
    const title = result.title?.trim();
    const titleHost = title && HOST_PATTERN.test(title) ? hostOf(`https://${title}`) : undefined;
    if (titleHost) hosts.add(titleHost);
  }
  return hosts;
}

export function extractUrlHosts(text: string): string[] {
  return [...new Set([...text.matchAll(URL_PATTERN)].flatMap((match) => hostOf(match[0]) ?? []))];
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url.replace(/[.,;:!?]+$/, "")).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
