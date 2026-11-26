// @summary Assembled-runtime grading for the basic-response capability task

import { describe, expect, test } from "bun:test";
import { basicResponseTask } from "../../../src/tasks/runtime/basic-response";
import { lastUserText, runScripted, text } from "../../helpers/scripted-runtime";

describe("basic-response", () => {
  test("passes the exact seeded reply and fails a reply without it", async () => {
    const passed = await runScripted(basicResponseTask, (_call, context) =>
      text(lastUserText(context).match(/PONG_\w+/)?.[0] ?? "missing"),
    );
    expect(passed.failures).toEqual([]);

    const failed = await runScripted(basicResponseTask, () => text("hello"));
    expect(failed.failure).toMatchObject({ code: "task_semantic.basic_response.answer", dimension: "semantic_goal" });
  });
});
