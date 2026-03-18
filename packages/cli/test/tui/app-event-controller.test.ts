// @summary Tests for app event controller notification and request orchestration
import { describe, expect, mock, test } from "bun:test";
import { AppEventController } from "../../src/tui/app-event-controller";
import { AppRuntimeState } from "../../src/tui/app-runtime-state";

describe("AppEventController", () => {
  test("routes turn completion to finish callback for current thread", async () => {
    const runtime = new AppRuntimeState("default", "medium");
    runtime.currentThreadId = "thread-1";
    const onTurnFinished = mock(() => {});
    const controller = new AppEventController({
      runtime,
      handleAgentEvent: () => {},
      onTurnFinished,
      onTurnErrored: () => {},
      onUserInputRequestResolved: () => {},
      onAccountLoginCompleted: () => {},
      requestApproval: async () => "once",
      requestUserInput: async () => ({ answers: {} }),
    });

    await controller.handleServerNotification({
      method: "turn/completed",
      params: { threadId: "thread-1" },
    });

    expect(onTurnFinished).toHaveBeenCalledTimes(1);
  });

  test("maps thread status changed notifications to status_change events", async () => {
    const runtime = new AppRuntimeState("default", "medium");
    runtime.currentThreadId = "thread-1";
    const handleAgentEvent = mock(() => {});
    const controller = new AppEventController({
      runtime,
      handleAgentEvent,
      onTurnFinished: () => {},
      onTurnErrored: () => {},
      onUserInputRequestResolved: () => {},
      onAccountLoginCompleted: () => {},
      requestApproval: async () => "once",
      requestUserInput: async () => ({ answers: {} }),
    });

    await controller.handleServerNotification({
      method: "thread/status/changed",
      params: { threadId: "thread-1", status: "idle" },
    });

    expect(handleAgentEvent).toHaveBeenCalledWith({ type: "status_change", status: "idle" });
  });

  test("delegates approval server requests", async () => {
    const runtime = new AppRuntimeState("default", "medium");
    const requestApproval = mock(async () => "always" as const);
    const controller = new AppEventController({
      runtime,
      handleAgentEvent: () => {},
      onTurnFinished: () => {},
      onTurnErrored: () => {},
      onUserInputRequestResolved: () => {},
      onAccountLoginCompleted: () => {},
      requestApproval,
      requestUserInput: async () => ({ answers: {} }),
    });

    const response = await controller.handleServerRequest(1, {
      id: 1,
      method: "approval/request",
      params: {
        request: {
          toolName: "bash",
          permission: "execute",
          description: "run command",
        },
      },
    });

    expect(requestApproval).toHaveBeenCalledTimes(1);
    expect(response).toEqual({
      method: "approval/request",
      result: { decision: "always" },
    });
  });
});
