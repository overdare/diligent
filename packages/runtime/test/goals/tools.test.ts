// @summary Goal tool assembly, validation, cancellation, and prompt contracts

import { describe, expect, test } from "bun:test";
import type { ToolContext } from "@diligent/core/tool-contract";
import { filterToolsByMode } from "../../src/app-server/factory";
import { createGoalTools, type GoalCreateInput, type GoalToolHost, goalPrompt } from "../../src/goals/tools";
import { isImmutableTool } from "../../src/tools/immutable";

const context = (signal = new AbortController().signal): ToolContext => ({
  toolCallId: "goal-create",
  signal,
  abort: () => {},
});

function host(create?: GoalToolHost["create"]): GoalToolHost {
  return { controller: () => undefined, scope: () => undefined, ...(create ? { create } : {}) };
}

describe("create_goal", () => {
  test("is exposed only when the root host can buffer creation", () => {
    expect(createGoalTools(host()).map((tool) => tool.name)).toEqual(["get_goal", "update_goal"]);
    expect(createGoalTools(host(async (input) => ({ status: "pending", ...input }))).map((tool) => tool.name)).toEqual([
      "create_goal",
      "get_goal",
      "update_goal",
    ]);
  });

  test("uses the shared objective bounds and safe positive integer limits", () => {
    const tool = createGoalTools(host(async (input) => ({ status: "pending", ...input })))[0];
    expect(
      tool.parameters.safeParse({ objective: "Ship the verified fix", tokenBudget: 5000, maxTurns: 8 }).success,
    ).toBe(true);
    for (const input of [
      { objective: "   " },
      { objective: "x".repeat(4001) },
      { objective: "Ship", tokenBudget: 0 },
      { objective: "Ship", maxTurns: 1.5 },
      { objective: "Ship", maxTurns: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(tool.parameters.safeParse(input).success).toBe(false);
    }
  });

  test("forwards the validated request and executing tool signal as a pending creation", async () => {
    let received: { input: GoalCreateInput; signal: AbortSignal } | undefined;
    const tool = createGoalTools(
      host(async (input, signal) => {
        received = { input, signal };
        return { status: "pending", ...input };
      }),
    )[0];
    const controller = new AbortController();

    const result = await tool.execute(
      { objective: "Run tests until the regression is fixed", tokenBudget: 1200, maxTurns: 4 },
      context(controller.signal),
    );

    expect(received).toEqual({
      input: { objective: "Run tests until the regression is fixed", tokenBudget: 1200, maxTurns: 4 },
      signal: controller.signal,
    });
    expect(JSON.parse(result.output)).toEqual({
      status: "pending",
      objective: "Run tests until the regression is fixed",
      tokenBudget: 1200,
      maxTurns: 4,
    });
  });

  test("rejects before buffering when aborted and fails safely if the host disappears", async () => {
    let calls = 0;
    const mutableHost = host(async (input) => {
      calls++;
      return { status: "pending", ...input };
    });
    const tool = createGoalTools(mutableHost)[0];
    const aborted = new AbortController();
    aborted.abort();

    await expect(tool.execute({ objective: "Never buffer" }, context(aborted.signal))).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(calls).toBe(0);

    mutableHost.create = undefined;
    await expect(tool.execute({ objective: "Unavailable" }, context())).rejects.toThrow("unavailable");
  });

  test("is immutable and unavailable in plan mode", () => {
    const tools = createGoalTools(host(async (input) => ({ status: "pending", ...input })));
    expect(isImmutableTool("create_goal")).toBe(true);
    expect(filterToolsByMode("default", tools).some((tool) => tool.name === "create_goal")).toBe(true);
    expect(filterToolsByMode("plan", tools).some((tool) => tool.name === "create_goal")).toBe(false);
  });

  test("description reserves creation for explicit persistent intent and makes acceptance timing clear", () => {
    const tool = createGoalTools(host(async (input) => ({ status: "pending", ...input })))[0];
    expect(tool.description).toContain("explicitly asks");
    expect(tool.description).toContain("ordinary task");
    expect(tool.description).toContain("quoted");
    expect(tool.description).toContain("finish the current response");
    expect(tool.description).toContain("explicitly specified");
  });
});

test("active-goal prompt keeps goal controls user-owned while allowing explicit user-requested creation", () => {
  const prompt = goalPrompt({
    controller: () =>
      ({
        read: () => ({
          goal: { id: "g", objective: "Finish", status: "active" },
          sequence: 1,
        }),
      }) as never,
    scope: () => undefined,
  });

  expect(prompt).toContain("create_goal only for explicit user intent");
  expect(prompt).toContain("Only the user can edit, resume, pause, or change goal limits");
});
