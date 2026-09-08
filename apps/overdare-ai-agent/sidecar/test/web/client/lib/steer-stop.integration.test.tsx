// @summary Stop auto-restart preserves pending steer attachments through production Web hooks
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, expect, test } from "bun:test";
import type { DiligentServerNotification } from "@diligent/protocol";
import { act, StrictMode, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { StreamingIndicator } from "../../../../src/web/client/components/StreamingIndicator";
import { appReducer } from "../../../../src/web/client/lib/app-state";
import type { WebRpcClient } from "../../../../src/web/client/lib/rpc-client";
import { initialThreadState } from "../../../../src/web/client/lib/thread-store";
import { useAppActions } from "../../../../src/web/client/lib/use-app-actions";
import { useAppRpcBindings } from "../../../../src/web/client/lib/use-app-lifecycle";
import { useSteeringQueue } from "../../../../src/web/client/lib/use-steering-queue";
import { toWebImageUrl } from "../../../../src/web/shared/image-routes";

afterAll(() => {
  void GlobalRegistrator.unregister();
});

for (const scenario of ["local", "hydrated", "failed", "empty", "already-idle"] as const) {
  const interruptFails = scenario === "failed";
  test(
    interruptFails
      ? "failed Stop keeps the queue and draft without adding UI"
      : scenario === "empty" || scenario === "already-idle"
        ? "Stop with no pending steer does not restart"
        : `Stop automatically resubmits the first ${scenario} steer with its images and preserves the draft`,
    async () => {
      const image = {
        type: "local_image" as const,
        path: scenario === "hydrated" ? ".overdare/images/reference.png" : "/project/.overdare/images/reference.png",
        mediaType: "image/png" as const,
      };
      const attachments = Array.from({ length: 5 }, (_, index) => ({ ...image, fileName: `${index}.png` }));
      const firstText =
        "<AttachedContext>\n- Instance: Name=Part; ClassType=Part; GUID=guid-1\n</AttachedContext>\nfirst";
      const calls: Array<{ method: string; params: unknown }> = [];
      let releaseInterrupt!: () => void;
      const interruptGate = new Promise<void>((resolve) => {
        releaseInterrupt = resolve;
      });
      let notify: (notification: DiligentServerNotification) => void = () => {};
      let interruptCount = 0;
      const rpc = {
        onNotification(listener: typeof notify) {
          notify = listener;
        },
        onServerRequest() {},
        async request(method: string, params: unknown) {
          calls.push({ method, params });
          if (method === "turn/interrupt") {
            interruptCount += 1;
            if (interruptCount === 1) {
              await interruptGate;
              if (interruptFails) throw new Error("offline");
              if (scenario !== "already-idle") {
                notify({ method: "turn/interrupted", params: { threadId: "t1", turnId: "turn1" } });
                notify({ method: "turn/interrupted", params: { threadId: "t1", turnId: "turn1" } });
              }
              return { interrupted: scenario !== "already-idle" };
            }
            notify({ method: "turn/interrupted", params: { threadId: "t1", turnId: "turn2" } });
            return { interrupted: true };
          }
          if (method === "thread/read")
            return {
              cwd: "/project",
              items: [],
              errors: [],
              hasFollowUp: false,
              pendingSteers: [],
              entryCount: 0,
              isRunning: false,
            };
          if (method === "turn/steer") return { queued: true, steerId: "local" };
          if (method === "turn/steer/update") return { updated: true };
          if (method === "turn/start") {
            notify({
              method: "turn/started",
              params: { threadId: "t1", turnId: "turn2", threadStatus: "busy" },
            });
            return { accepted: true, userMessageId: "next-user" };
          }
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
          pendingSteers:
            scenario === "hydrated"
              ? [
                  { id: "a", content: firstText, attachments },
                  { id: "b", content: "second", attachments: [image] },
                ]
              : [],
        });
        const [input, setInput] = useState("first");
        const [images, setImages] = useState(attachments.map((a) => ({ ...a, webUrl: toWebImageUrl(a.path) })));
        const rpcRef = useRef(rpc);
        const stateRef = useRef(state);
        stateRef.current = state;
        const activeThreadIdRef = useRef("t1");
        const modelRef = useRef(undefined);
        const steering = useSteeringQueue({
          rpcRef,
          stateRef,
          dispatch,
          activeThreadId: "t1",
          currentModelRef: modelRef,
          activeInput: input,
          pendingImages: images,
          contextItems: [],
          isBusy: true,
          clearThreadInput: () => setInput(""),
          clearPendingImages: () => setImages([]),
          clearContextItems: noop,
        });
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
          steering,
          setOauthPending: noop,
          setOauthError: noop,
        });
        const actions = useAppActions({
          rpcRef,
          state,
          stateRef,
          dispatch,
          activeInput: input,
          activeContextItems: [],
          pendingImages: images,
          canSend: state.threadStatus === "idle",
          isUploadingImages: false,
          supportsVision: true,
          effort: "medium",
          slashCommands: [],
          currentModel: undefined,
          availableModels: [],
          currentModelRef: modelRef,
          clearThreadInput: () => setInput(""),
          clearDraftInput: noop,
          clearActiveContextItems: noop,
          setPendingImages: setImages,
          steeringControl: steering,
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
            <button type="button" onClick={steering.handleSteer}>
              Steer
            </button>
            <button
              type="button"
              onClick={() => {
                steering.updateSteer(state.pendingSteers[0].id, firstText);
                setInput("draft");
                setImages([{ ...image, fileName: "draft.png", webUrl: toWebImageUrl(image.path) }]);
              }}
            >
              Edit and draft
            </button>
            <StreamingIndicator />
            <textarea value={input} readOnly />
            <output data-testid="pending-steers">{JSON.stringify(state.pendingSteers)}</output>
            <pre>{JSON.stringify(state.items.filter((item) => item.kind === "user"))}</pre>
            <footer>{images.map((image) => image.fileName).join(",")}</footer>
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
        if (scenario === "local" || interruptFails) {
          await act(async () => {
            element.querySelectorAll("button")[1].click();
          });
        }
        if (scenario !== "empty" && scenario !== "already-idle") {
          await act(async () => {
            element.querySelectorAll("button")[2].click();
          });
        }
        await act(async () => {
          element.querySelectorAll("button")[0].click();
          element.querySelectorAll("button")[0].click();
        });
        expect(element.querySelectorAll("button")[0].disabled).toBe(false);
        expect(element.textContent).not.toContain("Stopping…");
        expect(element.textContent).toContain("Thinking…");
        expect(calls.filter((call) => call.method === "turn/interrupt")).toHaveLength(1);
        expect(calls.filter((call) => call.method === "turn/start")).toHaveLength(0);
        await act(async () => {
          releaseInterrupt();
          await Promise.resolve();
        });
        expect(element.querySelectorAll("button")[0].disabled).toBe(false);
        expect(element.textContent).not.toContain("Stopping…");
        expect(element.querySelector("aside")?.textContent).toBe("");
        const starts = calls.filter((call) => call.method === "turn/start");
        if (scenario === "empty" || scenario === "already-idle") {
          expect(starts).toHaveLength(0);
          return;
        }
        expect(element.querySelector("textarea")?.value).toBe("draft");
        expect(element.querySelector("footer")?.textContent).toBe("draft.png");
        const remaining = JSON.parse(element.querySelector('[data-testid="pending-steers"]')!.textContent!);
        if (interruptFails) {
          expect(starts).toHaveLength(0);
          expect(remaining).toHaveLength(1);
          expect(remaining[0].attachments).toEqual(attachments);
        } else {
          expect(starts).toHaveLength(1);
          expect(starts[0].params).toMatchObject({
            message: firstText,
            content: [{ type: "text", text: firstText }, ...attachments],
          });
          expect(remaining.map((steer: { content: string }) => steer.content)).toEqual(
            scenario === "hydrated" ? ["second"] : [],
          );
          const users = JSON.parse(element.querySelector("pre")!.textContent!);
          expect(users).toHaveLength(1);
          expect(users[0].images).toEqual(
            attachments.map((a) => ({ mediaType: a.mediaType, fileName: a.fileName, url: toWebImageUrl(a.path) })),
          );
          if (scenario === "local") {
            await act(async () => {
              element.querySelectorAll("button")[0].click();
              await Promise.resolve();
            });
            expect(calls.filter((call) => call.method === "turn/interrupt")).toHaveLength(2);
            expect(calls.filter((call) => call.method === "turn/start")).toHaveLength(1);
            expect(element.textContent).not.toContain("Stopping…");
          }
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
