import { describe, expect, test } from "bun:test";
import { projectObservation } from "../../src/observability/content-policy";

describe("observability content policy", () => {
  const policy = { granted: true, generation: 1, userId: "user-1", contentMode: "none" as const };
  const observation = {
    generation: 1,
    userId: "user-1",
    attributes: { "llm.model_name": "example", "llm.token_count.total": 8, "input.value": "old secret" },
  };

  test("only exports allowed metadata and never mutates the original observation", () => {
    expect(projectObservation(observation, policy)).toEqual({
      "llm.model_name": "example",
      "llm.token_count.total": 8,
    });
    expect(observation.attributes["input.value"]).toBe("old secret");
  });

  test("drops observations after consent changes or identity changes", () => {
    expect(projectObservation(observation, { ...policy, granted: false })).toBeNull();
    expect(projectObservation(observation, { ...policy, generation: 2 })).toBeNull();
    expect(projectObservation(observation, { ...policy, userId: "user-2" })).toBeNull();
    expect(projectObservation(observation, { ...policy, userId: undefined })).toBeNull();
  });

  test("does not trust unrecognized attributes or malformed allowed values", () => {
    expect(
      projectObservation(
        { ...observation, attributes: { "llm.model_name": { secret: "hidden" }, unknown: "hidden" } },
        policy,
      ),
    ).toEqual({});
  });

  test("rejects filesystem paths and invalid token counts in metadata", () => {
    expect(
      projectObservation(
        {
          ...observation,
          attributes: {
            "llm.model_name": "/Users/person/private-file",
            "llm.token_count.total": -1,
            "llm.token_count.prompt": Number.NaN,
            "llm.token_count.completion": 1.5,
          },
        },
        policy,
      ),
    ).toEqual({});
  });
});

test("retains recognized model providers for cost attribution but drops unrecognized provider text", () => {
  const policy = { granted: true, generation: 1, userId: "user", contentMode: "none" as const };
  expect(
    projectObservation(
      { generation: 1, userId: "user", attributes: { "llm.provider": "openai", "llm.system": "anthropic" } },
      policy,
    ),
  ).toEqual({ "llm.provider": "openai", "llm.system": "anthropic" });
  expect(
    projectObservation(
      { generation: 1, userId: "user", attributes: { "llm.provider": "private provider text" } },
      policy,
    ),
  ).toEqual({});
});
