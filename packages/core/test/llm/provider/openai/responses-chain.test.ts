// @summary Tests for provider-neutral previous_response_id chain planning
import { describe, expect, test } from "bun:test";
import {
  createResponsesChainBaseline,
  planResponsesChainedInput,
} from "../../../../src/llm/provider/openai/responses-chain";

const user = (text: string) => ({ type: "message", role: "user", content: [{ type: "input_text", text }] });
const firstRequest = { model: "m", stream: true, prompt_cache_key: "s", input: [user("first")] };
const responseItems = [{ role: "assistant", content: "answer" }];

describe("planResponsesChainedInput", () => {
  test("returns only the items appended after the previous input and response output", () => {
    const baseline = createResponsesChainBaseline(firstRequest, "resp_1", responseItems);

    const plan = planResponsesChainedInput(baseline, {
      ...firstRequest,
      input: [...firstRequest.input, ...responseItems, user("second")],
    });

    expect(plan).toEqual({ previousResponseId: "resp_1", input: [user("second")] });
  });

  test("ignores per-request client metadata and previous response fields", () => {
    const baseline = createResponsesChainBaseline(
      { ...firstRequest, client_metadata: { "x-codex-turn-state": "a" } },
      "resp_1",
      responseItems,
    );

    const plan = planResponsesChainedInput(baseline, {
      ...firstRequest,
      client_metadata: { "x-codex-turn-state": "b" },
      previous_response_id: "stale",
      input: [...firstRequest.input, ...responseItems, user("second")],
    });

    expect(plan?.input).toEqual([user("second")]);
  });

  test("breaks the chain when a context option changes", () => {
    const baseline = createResponsesChainBaseline(firstRequest, "resp_1", responseItems);

    expect(
      planResponsesChainedInput(baseline, {
        ...firstRequest,
        reasoning: { effort: "high" },
        input: [...firstRequest.input, ...responseItems, user("second")],
      }),
    ).toBeUndefined();
  });

  test("breaks the chain when earlier history no longer matches what the server holds", () => {
    const baseline = createResponsesChainBaseline(firstRequest, "resp_1", responseItems);

    expect(
      planResponsesChainedInput(baseline, {
        ...firstRequest,
        input: [user("edited first"), ...responseItems, user("second")],
      }),
    ).toBeUndefined();
    expect(
      planResponsesChainedInput(baseline, {
        ...firstRequest,
        input: [...firstRequest.input, { role: "assistant", content: "different answer" }, user("second")],
      }),
    ).toBeUndefined();
  });

  test("does not chain when nothing new was appended", () => {
    const baseline = createResponsesChainBaseline(firstRequest, "resp_1", responseItems);

    expect(
      planResponsesChainedInput(baseline, { ...firstRequest, input: [...firstRequest.input, ...responseItems] }),
    ).toBeUndefined();
  });
});
