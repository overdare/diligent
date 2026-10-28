// @summary Missed goal events recover through snapshot reads and expose actionable controls
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, expect, test } from "bun:test";
import type { ThreadGoal } from "@diligent/protocol";
import { act, useReducer } from "react";
import { createRoot } from "react-dom/client";
import { GoalStatus } from "../../../../src/web/client/components/GoalStatus";
import { appReducer } from "../../../../src/web/client/lib/app-state";
import type { WebRpcClient } from "../../../../src/web/client/lib/rpc-client";
import { initialThreadState } from "../../../../src/web/client/lib/thread-store";
import { useGoalReconciliation } from "../../../../src/web/client/lib/use-app-lifecycle";

afterAll(() => void GlobalRegistrator.unregister());

test("a missed stop notification is recovered on focus and Resume remains clickable", async () => {
  const goal: ThreadGoal = {
    id: "goal",
    threadId: "thread",
    revision: 1,
    objective: "Finish",
    status: "active",
    turnsUsed: 1,
    tokensUsed: 0,
    cacheReadTokens: 0,
    activeTimeMs: 0,
    accountingScope: "reported_agent_tokens",
    createdAt: 1,
    updatedAt: 1,
  };
  let latest = { goal, sequence: 1 };
  const requests: unknown[] = [];
  const rpcRef = {
    current: {
      request: async (method: string, params: unknown) => {
        requests.push({ method, params });
        return latest;
      },
    } as unknown as WebRpcClient,
  };
  let resumed = 0;
  function Harness() {
    const [state, dispatch] = useReducer(appReducer, {
      ...initialThreadState,
      activeThreadId: "thread",
      goal,
      goalSequence: 1,
    });
    useGoalReconciliation(rpcRef, state.activeThreadId, true, true, dispatch);
    return (
      state.goal && (
        <GoalStatus
          goal={state.goal}
          onPause={() => {}}
          onResume={() => {
            resumed++;
          }}
          onClear={() => {}}
        />
      )
    );
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Harness />));
    expect(container.textContent).toContain("In progress");
    latest = { goal: { ...goal, revision: 2, status: "paused", reason: "persistence_error" }, sequence: 2 };
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(requests.at(-1)).toEqual({ method: "thread/goal/get", params: { threadId: "thread" } });
    expect(container.querySelector("output")?.textContent).toContain("Goal state could not be saved");
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Resume");
    expect(button).toBeDefined();
    await act(async () => button!.click());
    expect(resumed).toBe(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
