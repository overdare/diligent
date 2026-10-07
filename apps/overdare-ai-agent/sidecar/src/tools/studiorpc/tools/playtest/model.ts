// @summary Native Laya choice adapter; rejects truncated state and out-of-catalog answers.
import type { PlaytestDecisionCandidate, PlaytestDecisionContext, PlaytestFrame } from "./frame";

type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;
interface LayaChooserOptions {
  url: string;
  model: string;
  goal: string;
  fetch?: HttpFetch;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createLayaChooser(options: LayaChooserOptions) {
  const endpoint = new URL(options.url);
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new Error("Laya requires an HTTP(S) decision URL without embedded credentials");
  }
  const request = options.fetch ?? ((url, init) => fetch(url, init));
  async function post(body: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    const response = await request(endpoint.href, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const text = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Laya returned invalid JSON (HTTP ${response.status})`);
    }
    if (!response.ok || !record(data) || data.error) {
      const detail = record(data) && typeof data.error === "string" ? data.error.slice(0, 240) : "invalid response";
      throw new Error(`Laya HTTP ${response.status}: ${detail}`);
    }
    if (data.state_truncated === true)
      throw new Error("Laya truncated the state; shorten the adapter's state before retrying");
    return data;
  }
  return {
    warm: (signal: AbortSignal) =>
      post({ model: options.model, keep_alive: -1 }, AbortSignal.any([signal, AbortSignal.timeout(30_000)])),
    async choose(
      frame: PlaytestFrame,
      candidates: PlaytestDecisionCandidate[],
      signal: AbortSignal,
      context?: PlaytestDecisionContext,
    ) {
      const started = performance.now();
      const data = await post(
        {
          model: options.model,
          state: {
            goal: options.goal,
            game: frame.decisionState ?? frame.state,
            ...(context === undefined ? {} : { controller: context }),
          },
          questions: {
            action: {
              type: "choice",
              instructions: "Choose the next available action that advances the playtest goal. Use the observed state.",
              criteria: Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate.description])),
            },
          },
          keep_alive: -1,
        },
        signal,
      );
      const answer = record(data.answers) ? data.answers.action : undefined;
      const actionId = record(answer) ? answer.choice : undefined;
      if (typeof actionId !== "string" || !candidates.some((candidate) => candidate.id === actionId)) {
        throw new Error("Laya returned an unavailable action");
      }
      return {
        actionId,
        diagnostics: {
          model: data.model,
          confidence: record(answer) ? answer.confidence : undefined,
          probabilities: record(answer) ? answer.probabilities : undefined,
          usage: data.usage,
        },
        latencyMs: performance.now() - started,
      };
    },
  };
}
