// @summary Runtime accepts trusted injections only when they enter live conversation context
import { expect, test } from "bun:test";
import { acceptContextInjectionMetadata, acknowledgeContextInjection } from "../../src/agent/context-acceptance";
import { RuntimeAgent } from "../../src/agent/runtime-agent";
import { makeAssistant, makeStreamFn, TEST_MODEL } from "../helpers/collab";

test("runtime acknowledges a real injection before sampling, once, without serialized callbacks", async () => {
  let accepted = 0;
  const injection = acknowledgeContextInjection({ source: "test", content: "external changes" }, () => {
    accepted++;
  });
  expect(accepted).toBe(0);
  expect(JSON.stringify(injection.metadata)).not.toContain("function");
  let sampled = false;
  const stream = makeStreamFn([makeAssistant()]);
  const agent = new RuntimeAgent(TEST_MODEL, [], [], {
    loopHooks: [{ id: "test", beforeTurn: () => [injection] }],
    llmMsgStreamFn(model, context, options) {
      expect(accepted).toBe(1);
      expect(
        context.messages.some((message) => message.role === "user" && message.content === "external changes"),
      ).toBe(true);
      sampled = true;
      return stream(model, context, options);
    },
  });
  await agent.prompt("work");
  acceptContextInjectionMetadata(injection.metadata);
  expect(sampled).toBe(true);
  expect(accepted).toBe(1);
});

test("a rejected hook does not acknowledge an injection it could not deliver", async () => {
  let accepted = false;
  acknowledgeContextInjection({ source: "test", content: "undelivered" }, () => {
    accepted = true;
  });
  const agent = new RuntimeAgent(TEST_MODEL, [], [], {
    loopHooks: [
      {
        id: "test",
        beforeTurn() {
          throw new Error("capture failed before delivery");
        },
      },
    ],
    llmMsgStreamFn: makeStreamFn([makeAssistant()]),
  });
  await agent.prompt("work");
  expect(accepted).toBe(false);
});
