// @summary Web stop-to-send integration over production notification, restoration, and action hooks
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, expect, test } from "bun:test";
import type { DiligentServerNotification } from "@diligent/protocol";
import { act, StrictMode, useReducer, useRef } from "react";
import { createRoot } from "react-dom/client";
import { appReducer } from "../../../../src/web/client/lib/app-state";
import { EMPTY_COMPOSER_DRAFT } from "../../../../src/web/client/lib/composer-state";
import type { WebRpcClient } from "../../../../src/web/client/lib/rpc-client";
import { initialThreadState } from "../../../../src/web/client/lib/thread-store";
import { useAppActions } from "../../../../src/web/client/lib/use-app-actions";
import { useAppRpcBindings } from "../../../../src/web/client/lib/use-app-lifecycle";

afterAll(() => {
  void GlobalRegistrator.unregister();
});

for (const interruptFails of [false, true]) {
  test(
    interruptFails
      ? "failed Stop keeps the queue and draft without adding UI"
      : "Stop restores unconsumed input; only explicit Send submits text, context, and every image once",
    async () => {
      const image = { type: "local_image" as const, path: "reference.png", mediaType: "image/png" as const };
      const attachments = Array.from({ length: 5 }, (_, index) => ({ ...image, fileName: `${index}.png` }));
      const calls: Array<{ method: string; params: unknown }> = [];
      let notify: (notification: DiligentServerNotification) => void = () => {};
      const rpc = {
        onNotification(listener: typeof notify) {
          notify = listener;
        },
        onServerRequest() {},
        async request(method: string, params: unknown) {
          calls.push({ method, params });
          if (method === "turn/interrupt") {
            if (interruptFails) throw new Error("offline");
            // The preceding consumption and interruption arrive in the same React batch.
            notify({
              method: "agent/event",
              params: {
                threadId: "t1",
                turnId: "turn1",
                event: {
                  type: "steering_injected",
                  steerIds: ["used"],
                  messageCount: 1,
                  messages: [{ role: "user", content: "already consumed", timestamp: 1 }],
                },
              },
            });
            notify({ method: "turn/interrupted", params: { threadId: "t1", turnId: "turn1" } });
            return { interrupted: true };
          }
          if (method === "turn/start") return { accepted: true, userMessageId: "next-user" };
          throw new Error(`Unexpected RPC: ${method}`);
        },
      } as unknown as WebRpcClient;
      const noop = () => {};
      const asyncNoop = async () => {};
      function Harness() {
        const [state, dispatch] = useReducer(appReducer, {
          ...initialThreadState,
          activeThreadId: "t1",
          threadStatus: "busy",
          composerDrafts: { t1: { ...EMPTY_COMPOSER_DRAFT, text: "draft" } },
          pendingSteers: [
            { id: "used", content: "already consumed" },
            {
              id: "a",
              content:
                "<AttachedContext>\n- Instance: Name=Part; ClassType=Part; GUID=guid-1\n</AttachedContext>\nfirst",
              attachments: attachments.slice(0, 3),
            },
            { id: "b", content: "second", attachments: attachments.slice(3) },
          ],
        });
        const draft = state.composerDrafts.t1 ?? EMPTY_COMPOSER_DRAFT;
        const rpcRef = useRef(rpc);
        const stateRef = useRef(state);
        stateRef.current = state;
        const activeThreadIdRef = useRef("t1");
        useAppRpcBindings({
          rpcRef,
          stateRef,
          activeThreadIdRef,
          dispatch,
          refreshThreadList: asyncNoop,
          onAccountLoginCompleted: noop,
          onAccountUpdated: asyncNoop,
          onMcpLoginCompleted: noop,
          markAttention: noop,
          onBackgroundNotification: noop,
          handleServerRequest: noop,
          setOauthPending: noop,
          setOauthError: noop,
        });
        const actions = useAppActions({
          rpcRef,
          state,
          stateRef,
          dispatch,
          activeInput: draft.text,
          activeContextItems: draft.contextItems,
          pendingImages: draft.images,
          canSend: state.threadStatus === "idle",
          isUploadingImages: false,
          supportsVision: true,
          effort: "medium",
          slashCommands: [],
          currentModel: undefined,
          availableModels: [],
          currentModelRef: useRef(undefined),
          clearThreadInput: () => dispatch({ type: "composer_text", payload: { threadId: "t1", text: "" } }),
          clearDraftInput: noop,
          clearActiveContextItems: () => dispatch({ type: "composer_context", payload: { threadId: "t1", items: [] } }),
          setPendingImages: (images) => dispatch({ type: "composer_images", payload: { threadId: "t1", images } }),
          setIsUploadingImages: noop,
          setShowImageUploadIndicator: noop,
          setEffortState: noop,
          changeModel: asyncNoop,
          startNewThread: asyncNoop,
          openThread: asyncNoop,
          openMcpModal: noop,
          bumpMcpRefreshNonce: noop,
          setSkills: noop,
          modeRef: useRef<"default">("default"),
          cwdRef: useRef("/project"),
          applySessionModel: asyncNoop,
          activateServerThread: async () => {
            throw new Error("Unexpected thread activation");
          },
          refreshThreadList: asyncNoop,
        });
        return (
          <>
            <button type="button" onClick={actions.handleInterrupt}>
              Stop
            </button>
            <button type="button" onClick={actions.handleSend}>
              Send
            </button>
            <textarea value={draft.text} readOnly />
            <output>{state.pendingSteers.length}</output>
            <aside>{state.toast?.message ?? ""}</aside>
          </>
        );
      }
      const element = document.createElement("div");
      document.body.append(element);
      const root = createRoot(element);
      try {
        await act(async () => {
          root.render(
            <StrictMode>
              <Harness />
            </StrictMode>,
          );
        });
        await act(async () => {
          element.querySelectorAll("button")[0].click();
        });
        expect(calls.map((call) => call.method)).toEqual(["turn/interrupt"]);
        expect(element.querySelector("aside")?.textContent).toBe("");
        if (interruptFails) {
          expect(element.querySelector("textarea")?.value).toBe("draft");
          expect(element.querySelector("output")?.textContent).toBe("3");
        } else {
          expect(element.querySelector("textarea")?.value).toBe("first\n\nsecond\n\ndraft");
          expect(element.querySelector("output")?.textContent).toBe("0");
          await act(async () => {
            element.querySelectorAll("button")[1].click();
          });
          expect(calls.map((call) => call.method)).toEqual(["turn/interrupt", "turn/start"]);
          const sent = calls[1].params as { message: string; content: unknown[] };
          expect(sent.message).toContain("GUID=guid-1");
          expect(sent.message.endsWith("first\n\nsecond\n\ndraft")).toBe(true);
          expect(sent.message).not.toContain("already consumed");
          expect(sent.content).toEqual([{ type: "text", text: sent.message }, ...attachments]);
        }
      } finally {
        await act(async () => {
          root.unmount();
        });
        element.remove();
      }
    },
  );
}
