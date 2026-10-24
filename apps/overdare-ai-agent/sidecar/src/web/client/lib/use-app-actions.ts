// @summary App action handlers for sending, image uploads, slash commands, and turn controls

import { createLogger } from "@diligent/logging";
import type {
  GoalChange,
  ImageUploadAttachment,
  Mode,
  ModelInfo,
  ModelRef,
  PendingSteer,
  SkillInfo,
  ThinkingEffort,
  ThreadGoalResponse,
  ThreadReadResponse,
} from "@diligent/protocol";
import { DILIGENT_CLIENT_REQUEST_METHODS, LocalImageBlockSchema } from "@diligent/protocol";
import { parseGoalCommand } from "@diligent/runtime/client";
import { type Dispatch, type MutableRefObject, type RefObject, type SetStateAction, useCallback, useRef } from "react";
import { toWebImageUrl } from "../../shared/image-routes";
import { type AgentContextItem, prependContextToMessage } from "./agent-native-bridge";
import type { AppAction, PendingImage } from "./app-state";
import { fileToBase64, normalizeImageFileName, replaceThreadUrl } from "./app-utils";
import {
  findModelInfo,
  getThinkingEffortUsage,
  modelOptionKey,
  normalizeThinkingEffort,
  resolveModelSelector,
  supportsThinkingEffort,
} from "./model-thinking-helpers";
import type { WebRpcClient } from "./rpc-client";
import { modeForCommand, parseSlashCommand, type SlashCommand } from "./slash-commands";
import type { RenderItem, ThreadState } from "./thread-store";
import { createUuidV4 } from "./uuid";

const IMAGE_UPLOAD_INDICATOR_DELAY_MS = 200;
const logger = createLogger({ scope: "web.client.actions" });

export async function executeGoalCommand({
  rpc,
  threadId,
  args,
}: {
  rpc: WebRpcClient;
  threadId: string;
  args?: string;
}): Promise<ThreadGoalResponse> {
  const current = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_GOAL_GET, { threadId });
  const change = parseGoalCommand(args, current.goal);
  if (change === null) return current;
  return rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_GOAL_SET, { threadId, ...change });
}

export function clearComposerInputAfterSend({
  activeThreadId,
  clearThreadInput,
  clearDraftInput,
  clearContextItems,
}: {
  activeThreadId: string | null;
  clearThreadInput: (threadId: string) => void;
  clearDraftInput: () => void;
  clearContextItems: () => void;
}): void {
  clearContextItems();
  if (activeThreadId) {
    clearThreadInput(activeThreadId);
    return;
  }
  clearDraftInput();
}

type SteeringControl = {
  pendingAbortRestartSteerRef: MutableRefObject<PendingSteer | null>;
};

interface NewThreadOptions {
  rpc: WebRpcClient;
  mode: Mode;
  cwd: string;
  model?: ModelRef;
  effort: ThinkingEffort;
  fastMode?: boolean;
  activateServerThread: (threadId: string) => Promise<ThreadReadResponse>;
  dispatch: Dispatch<AppAction>;
  isCurrent: () => boolean;
}

async function startAndHydrateThread({
  rpc,
  mode,
  cwd,
  model,
  effort,
  fastMode,
  activateServerThread,
  dispatch,
  isCurrent,
}: NewThreadOptions): Promise<{ threadId: string; history: ThreadReadResponse }> {
  const started = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START, {
    cwd: cwd || "/",
    mode,
    effort,
    fastMode,
    model,
  });
  const threadId = started.threadId;
  if (!isCurrent()) throw new Error("Conversation selection changed");
  const history = await activateServerThread(threadId);
  if (!isCurrent()) throw new Error("Conversation selection changed");
  dispatch({ type: "hydrate", payload: { threadId, mode, history } });
  if (typeof window !== "undefined") {
    replaceThreadUrl(threadId);
  }
  return { threadId, history };
}

export async function prepareNewThreadForFirstMessage({
  applySessionModel,
  localItemId,
  localText,
  contextItems,
  images,
  ...options
}: NewThreadOptions & {
  applySessionModel: (sessionModel?: ModelRef) => Promise<void>;
  localItemId: string;
  localText: string;
  contextItems: AgentContextItem[];
  images: PendingImage[];
}): Promise<{ threadId: string; history: ThreadReadResponse }> {
  const { threadId, history } = await startAndHydrateThread(options);
  options.dispatch({ type: "local_user", payload: { id: localItemId, text: localText, images, contextItems } });
  await applySessionModel(history.currentModel);
  return { threadId, history };
}

/** A goal can be the first thing in a new conversation: the server starts its first run once the goal is set. */
export async function startNewThreadWithGoal({
  applySessionModel,
  change,
  ...options
}: NewThreadOptions & {
  applySessionModel: (sessionModel?: ModelRef) => Promise<void>;
  change: Extract<GoalChange, { action: "set" }>;
}): Promise<{ threadId: string; snapshot: ThreadGoalResponse }> {
  const { threadId, history } = await startAndHydrateThread(options);
  options.dispatch({ type: "optimistic_thread", payload: { threadId, message: change.objective } });
  await applySessionModel(history.currentModel);
  if (!options.isCurrent()) throw new Error("Conversation selection changed");
  const snapshot = await options.rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_GOAL_SET, { threadId, ...change });
  return { threadId, snapshot };
}

export async function runThreadCompaction({
  rpc,
  threadId,
  refreshThreadHistory,
  isCurrent,
  dispatch,
}: {
  rpc: WebRpcClient;
  threadId: string;
  refreshThreadHistory: (threadId: string) => Promise<void>;
  isCurrent: () => boolean;
  dispatch: Dispatch<AppAction>;
}): Promise<void> {
  try {
    await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_COMPACT_START, { threadId }, null);
    if (!isCurrent()) return;
    await refreshThreadHistory(threadId);
  } catch (error) {
    if (!isCurrent()) return;
    dispatch({ type: "compaction_error" });
    dispatch({
      type: "show_info_toast",
      payload: error instanceof Error ? error.message : "Compaction failed.",
    });
  }
}

export function getModelChangeThreadId(activeThreadId: string | null): string | undefined {
  return activeThreadId ?? undefined;
}

export async function applyModeChange({
  rpc,
  activeThreadId,
  mode,
  dispatch,
}: {
  rpc: WebRpcClient | null;
  activeThreadId: string | null;
  mode: Mode;
  dispatch: Dispatch<AppAction>;
}): Promise<void> {
  dispatch({ type: "set_mode", payload: mode });
  if (!rpc || !activeThreadId) return;
  await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.MODE_SET, { threadId: activeThreadId, mode });
}

/** Resend a previous request exactly as submitted: text, attached context, and images. */
export async function retryLastUserMessage({
  rpc,
  threadId,
  item,
  model,
  dispatch,
}: {
  rpc: WebRpcClient;
  threadId: string;
  item: Extract<RenderItem, { kind: "user" }>;
  model?: ModelRef;
  dispatch: Dispatch<AppAction>;
}): Promise<void> {
  const contextItems = item.contextItems ?? [];
  const message = prependContextToMessage(item.text, contextItems);
  const attachments = item.images.map((image) => {
    const parsed = LocalImageBlockSchema.safeParse({
      type: "local_image",
      path: image.path,
      mediaType: image.mediaType,
      fileName: image.fileName,
    });
    if (!parsed.success) throw new Error(`The attached image ${image.fileName ?? image.url} can no longer be resent.`);
    return parsed.data;
  });
  if (!message && attachments.length === 0) throw new Error("The last request has no content to retry.");

  const localItemId = `local-user-${createUuidV4()}`;
  dispatch({
    type: "local_user",
    payload: {
      id: localItemId,
      text: item.text,
      contextItems,
      images: attachments.map((attachment) => ({ ...attachment, webUrl: toWebImageUrl(attachment.path) })),
    },
  });
  const started = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_START, {
    threadId,
    message,
    attachments,
    content: [...(message ? [{ type: "text" as const, text: message }] : []), ...attachments],
    model,
  });
  if (started.userMessageId) {
    dispatch({
      type: "bind_user_message_id",
      payload: { renderItemId: localItemId, messageId: started.userMessageId },
    });
  }
}

export function normalizeUploadedImageAttachment(attachment: ImageUploadAttachment): PendingImage {
  const webUrl = attachment.webUrl ?? toWebImageUrl(attachment.path);
  if (!attachment.webUrl && webUrl === attachment.path) {
    throw new Error("Image upload did not return a browser-accessible URL.");
  }
  return { ...attachment, webUrl };
}

export async function waitForDelayedIndicator<T>({
  task,
  delayMs,
  showIndicator,
}: {
  task: Promise<T>;
  delayMs: number;
  showIndicator: () => void;
}): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const delay = new Promise<"show">((resolve) => {
    timer = setTimeout(() => resolve("show"), delayMs);
  });

  try {
    const first = await Promise.race([
      task.then((value) => ({ type: "complete" as const, value })),
      delay.then(() => ({ type: "show" as const })),
    ]);

    if (first.type === "complete") {
      return first.value;
    }

    showIndicator();
    return await task;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function useAppActions({
  rpcRef,
  state,
  stateRef,
  dispatch,
  activeInput,
  activeContextItems,
  pendingImages,
  canSend,
  isUploadingImages,
  supportsVision,
  effort,
  fastMode,
  slashCommands,
  goalsSupported,
  currentModel,
  availableModels,
  currentModelRef,
  clearThreadInput,
  clearDraftInput,
  clearActiveContextItems,
  setPendingImages,
  setIsUploadingImages,
  setShowImageUploadIndicator,
  setEffortState,
  setFastModeState,
  changeModel,
  startNewThread,
  openThread,
  openMcpModal,
  bumpMcpRefreshNonce,
  setSkills,
  steeringControl,
  modeRef,
  cwdRef,
  applySessionModel,
  activateServerThread,
  refreshThreadList,
  refreshThreadHistory,
  getNavigationGuard,
}: {
  rpcRef: RefObject<WebRpcClient | null>;
  state: ThreadState;
  stateRef: RefObject<ThreadState>;
  dispatch: Dispatch<AppAction>;
  activeInput: string;
  activeContextItems: AgentContextItem[];
  pendingImages: PendingImage[];
  canSend: boolean;
  isUploadingImages: boolean;
  supportsVision: boolean;
  effort: ThinkingEffort;
  fastMode: boolean;
  slashCommands: SlashCommand[];
  goalsSupported: boolean;
  currentModel: ModelRef | undefined;
  availableModels: ModelInfo[];
  currentModelRef: RefObject<ModelRef | undefined>;
  clearThreadInput: (threadId: string) => void;
  clearDraftInput: () => void;
  clearActiveContextItems: () => void;
  setPendingImages: Dispatch<SetStateAction<PendingImage[]>>;
  setIsUploadingImages: Dispatch<SetStateAction<boolean>>;
  setShowImageUploadIndicator: Dispatch<SetStateAction<boolean>>;
  setEffortState: Dispatch<SetStateAction<ThinkingEffort>>;
  setFastModeState: Dispatch<SetStateAction<boolean>>;
  changeModel: (model: ModelRef, threadId?: string) => Promise<void>;
  startNewThread: () => Promise<void>;
  openThread: (threadId: string) => Promise<unknown>;
  openMcpModal: () => void;
  bumpMcpRefreshNonce: () => void;
  setSkills: Dispatch<SetStateAction<SkillInfo[]>>;
  steeringControl: SteeringControl;
  modeRef: RefObject<Mode>;
  cwdRef: RefObject<string>;
  applySessionModel: (sessionModel?: ModelRef) => Promise<void>;
  activateServerThread: (threadId: string) => Promise<ThreadReadResponse>;
  refreshThreadList: (rpc?: WebRpcClient | null) => Promise<unknown>;
  refreshThreadHistory: (threadId: string) => Promise<void>;
  getNavigationGuard: () => () => boolean;
}) {
  const sendMessage = useCallback(async (): Promise<void> => {
    const rpc = rpcRef.current;
    if (!rpc || !canSend || !stateRef.current.runtimeReady) return;
    const isCurrent = getNavigationGuard();
    const typedMessage = activeInput.trim();
    const message = prependContextToMessage(typedMessage, activeContextItems);
    const images = pendingImages;
    const localItemId = `local-user-${createUuidV4()}`;
    const existingThreadId = state.activeThreadId;
    clearComposerInputAfterSend({
      activeThreadId: existingThreadId,
      clearThreadInput,
      clearDraftInput,
      clearContextItems: clearActiveContextItems,
    });
    setPendingImages([]);

    try {
      let threadId = existingThreadId;
      if (!threadId) {
        const prepared = await prepareNewThreadForFirstMessage({
          rpc,
          mode: modeRef.current,
          cwd: cwdRef.current || "/",
          model: currentModelRef.current,
          effort,
          fastMode,
          activateServerThread,
          applySessionModel,
          dispatch,
          localItemId,
          localText: typedMessage,
          contextItems: activeContextItems,
          images,
          isCurrent,
        });
        if (!isCurrent()) return;
        threadId = prepared.threadId;
      } else {
        dispatch({
          type: "local_user",
          payload: { id: localItemId, text: typedMessage, images, contextItems: activeContextItems },
        });
      }

      if (state.items.length === 0 && threadId) {
        dispatch({
          type: "optimistic_thread",
          payload: { threadId, message: typedMessage || "[image]" },
        });
      }

      const content = [
        ...(message ? [{ type: "text" as const, text: message }] : []),
        ...images.map((image) => ({
          type: "local_image" as const,
          path: image.path,
          mediaType: image.mediaType,
          fileName: image.fileName,
        })),
      ];
      const started = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_START, {
        threadId,
        message,
        attachments: images.map((image) => ({
          type: "local_image" as const,
          path: image.path,
          mediaType: image.mediaType,
          fileName: image.fileName,
        })),
        content,
        model: currentModelRef.current,
      });
      if (!isCurrent()) return;
      if (started.userMessageId) {
        dispatch({
          type: "bind_user_message_id",
          payload: { renderItemId: localItemId, messageId: started.userMessageId },
        });
      }
      void refreshThreadList(rpc);
    } catch (error) {
      if (!isCurrent()) return;
      dispatch({
        type: "show_info_toast",
        payload: error instanceof Error ? error.message : "Could not send message.",
      });
      logger.error("message.send_failed", {
        message: "Failed to send message",
        error,
        threadId: existingThreadId ?? undefined,
      });
    }
  }, [
    rpcRef,
    state,
    canSend,
    activeInput,
    activeContextItems,
    pendingImages,
    clearThreadInput,
    clearDraftInput,
    clearActiveContextItems,
    setPendingImages,
    dispatch,
    currentModelRef,
    modeRef,
    cwdRef,
    effort,
    fastMode,
    applySessionModel,
    activateServerThread,
    refreshThreadList,
    getNavigationGuard,
    stateRef,
  ]);

  const setMode = useCallback(
    async (mode: Mode): Promise<void> => {
      await applyModeChange({ rpc: rpcRef.current, activeThreadId: state.activeThreadId, mode, dispatch });
    },
    [rpcRef, state.activeThreadId, dispatch],
  );

  const setEffort = useCallback(
    async (nextEffort: ThinkingEffort): Promise<void> => {
      const modelInfo = findModelInfo(availableModels, currentModel);
      const unsupportedEffort = modelInfo?.supportsThinking === true && !supportsThinkingEffort(modelInfo, nextEffort);
      if (unsupportedEffort) {
        dispatch({
          type: "show_info_toast",
          payload: `Thinking effort "${nextEffort}" is not supported for this model.`,
        });
        return;
      }
      // Always update local state so draft (new conversation) picks up the change.
      setEffortState(nextEffort);
      // Persist to server only when a thread is active.
      const rpc = rpcRef.current;
      if (rpc && state.activeThreadId) {
        await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.EFFORT_SET, {
          threadId: state.activeThreadId,
          effort: nextEffort,
        });
      }
    },
    [rpcRef, state.activeThreadId, availableModels, currentModel, dispatch, setEffortState],
  );

  const handleCompactionClick = useCallback(() => {
    void (async () => {
      const rpc = rpcRef.current;
      if (!rpc || !state.activeThreadId || state.isCompacting || !stateRef.current.runtimeReady) return;
      await runThreadCompaction({
        rpc,
        threadId: state.activeThreadId,
        refreshThreadHistory,
        isCurrent: getNavigationGuard(),
        dispatch,
      });
    })();
  }, [rpcRef, state.activeThreadId, state.isCompacting, stateRef, dispatch, refreshThreadHistory, getNavigationGuard]);

  const handleAddImages = useCallback(
    async (files: FileList | File[]): Promise<void> => {
      const rpc = rpcRef.current;
      if (!rpc || isUploadingImages) return;

      const fileList = Array.from(files);
      if (pendingImages.length + fileList.length > 4) {
        dispatch({ type: "show_info_toast", payload: "You can attach up to 4 images per message." });
        return;
      }
      if (!supportsVision) {
        dispatch({ type: "show_info_toast", payload: "The selected model does not support image input." });
        return;
      }

      const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
      const uploadTimestamp = Date.now();
      const uploads: Array<{
        file: File;
        fileName: string;
        mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
      }> = [];

      for (const [index, file] of fileList.entries()) {
        const normalizedFileName = normalizeImageFileName(file, index, uploadTimestamp);
        if (!allowedTypes.has(file.type)) {
          dispatch({ type: "show_info_toast", payload: `Unsupported image type: ${normalizedFileName}` });
          return;
        }
        if (file.size > 10 * 1024 * 1024) {
          dispatch({ type: "show_info_toast", payload: `Image exceeds 10 MB: ${normalizedFileName}` });
          return;
        }

        uploads.push({
          file,
          fileName: normalizedFileName,
          mediaType: file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
        });
      }

      setIsUploadingImages(true);
      setShowImageUploadIndicator(false);
      try {
        const uploadTask = (async (): Promise<PendingImage[]> => {
          const uploaded: PendingImage[] = [];
          for (const upload of uploads) {
            const dataBase64 = await fileToBase64(upload.file);
            const result = await rpc.webRequest(DILIGENT_CLIENT_REQUEST_METHODS.IMAGE_UPLOAD, {
              threadId: state.activeThreadId ?? undefined,
              fileName: upload.fileName,
              mediaType: upload.mediaType,
              dataBase64,
            });
            uploaded.push(normalizeUploadedImageAttachment(result.attachment));
          }
          return uploaded;
        })();

        const uploaded = await waitForDelayedIndicator({
          task: uploadTask,
          delayMs: IMAGE_UPLOAD_INDICATOR_DELAY_MS,
          showIndicator: () => setShowImageUploadIndicator(true),
        });

        setPendingImages((previous) => [...previous, ...uploaded]);
      } catch (error) {
        dispatch({ type: "show_info_toast", payload: "Failed to upload images." });
        logger.error("images.upload_failed", {
          message: "Failed to upload images.",
          error,
          threadId: state.activeThreadId ?? undefined,
          fields: { imageCount: uploads.length },
        });
      } finally {
        setIsUploadingImages(false);
        setShowImageUploadIndicator(false);
      }
    },
    [
      rpcRef,
      isUploadingImages,
      pendingImages.length,
      supportsVision,
      setIsUploadingImages,
      setShowImageUploadIndicator,
      state.activeThreadId,
      setPendingImages,
      dispatch,
    ],
  );

  const handleRemovePendingImage = useCallback(
    (path: string) => {
      setPendingImages((previous) => previous.filter((image) => image.path !== path));
    },
    [setPendingImages],
  );

  const handleSlashCommand = useCallback(
    (name: string, arg?: string) => {
      const rpc = rpcRef.current;
      const activeThreadId = state.activeThreadId;

      if (activeThreadId) {
        clearThreadInput(activeThreadId);
      } else {
        clearDraftInput();
      }

      // Handled ahead of the switch so `case "default"` never sits beside its `default` clause.
      const modeTarget = modeForCommand(name);
      if (modeTarget) {
        void setMode(modeTarget);
        dispatch({ type: "show_info_toast", payload: `Mode: ${modeTarget}` });
        return;
      }

      switch (name) {
        case "help": {
          const names = slashCommands.map((command) => `/${command.name}`).join(", ");
          dispatch({ type: "show_info_toast", payload: `Commands: ${names}` });
          return;
        }
        case "new":
          void startNewThread();
          return;
        case "resume":
          if (!arg) {
            dispatch({ type: "show_info_toast", payload: "Usage: /resume <thread-id>" });
            return;
          }
          void openThread(arg);
          return;
        case "model": {
          if (!arg) {
            dispatch({ type: "show_info_toast", payload: "Usage: /model <model-id>" });
            return;
          }

          let selected: ModelInfo;
          try {
            selected = resolveModelSelector(availableModels, arg);
          } catch (error) {
            dispatch({
              type: "show_info_toast",
              payload: error instanceof Error ? error.message : `Unknown model: ${arg}`,
            });
            return;
          }

          void changeModel(selected, getModelChangeThreadId(activeThreadId)).then(() => {
            const normalizedEffort = normalizeThinkingEffort(selected, effort);
            if (normalizedEffort !== effort) {
              setEffortState(normalizedEffort);
              dispatch({
                type: "show_info_toast",
                payload: `Model switched to ${selected.provider}/${selected.modelId}. Thinking adjusted to ${normalizedEffort}.`,
              });
              return;
            }
            dispatch({
              type: "show_info_toast",
              payload: `Model switched to ${selected.provider}/${selected.modelId}`,
            });
          });
          return;
        }
        case "effort": {
          const modelInfo = findModelInfo(availableModels, currentModel);
          if (modelInfo && !modelInfo.supportsThinking) {
            dispatch({ type: "show_info_toast", payload: "This model does not support thinking effort settings." });
            return;
          }
          const usage = `/effort <${getThinkingEffortUsage(modelInfo)}>`;
          if (!arg) {
            dispatch({ type: "show_info_toast", payload: `Usage: ${usage}` });
            return;
          }
          const normalized = arg.toLowerCase();
          if (!["low", "medium", "high", "xhigh", "max"].includes(normalized)) {
            dispatch({ type: "show_info_toast", payload: `Unknown effort: ${arg}. Usage: ${usage}` });
            return;
          }
          void setEffort(normalized as ThinkingEffort);
          return;
        }
        case "goal": {
          if (!goalsSupported) {
            dispatch({ type: "show_info_toast", payload: "Goals are not supported by this app server." });
            return;
          }
          if (!rpc) {
            dispatch({ type: "show_info_toast", payload: "Not connected to the app server." });
            return;
          }
          if (!activeThreadId) {
            let change: GoalChange | null;
            try {
              change = parseGoalCommand(arg, null);
            } catch (cause) {
              dispatch({ type: "show_info_toast", payload: cause instanceof Error ? cause.message : String(cause) });
              return;
            }
            if (change?.action !== "set") {
              dispatch({ type: "show_info_toast", payload: "No goal is set for this thread." });
              return;
            }
            if (modeRef.current === "plan") {
              dispatch({ type: "show_info_toast", payload: "Goal execution is unavailable in plan mode" });
              return;
            }
            if (!stateRef.current.runtimeReady) {
              dispatch({ type: "show_info_toast", payload: "The agent is still starting. Try again in a moment." });
              return;
            }
            const isCurrent = getNavigationGuard();
            void startNewThreadWithGoal({
              rpc,
              mode: modeRef.current,
              cwd: cwdRef.current || "/",
              model: currentModelRef.current,
              effort,
              fastMode,
              activateServerThread,
              applySessionModel,
              dispatch,
              isCurrent,
              change,
            })
              .then(({ threadId, snapshot }) => {
                if (!isCurrent()) return;
                dispatch({ type: "set_goal_snapshot", payload: { threadId, ...snapshot } });
                void refreshThreadList(rpc);
              })
              .catch((cause) => {
                if (!isCurrent()) return;
                dispatch({
                  type: "show_info_toast",
                  payload: cause instanceof Error ? cause.message : String(cause),
                });
              });
            return;
          }
          void executeGoalCommand({ rpc, threadId: activeThreadId, args: arg })
            .then((snapshot) => {
              dispatch({ type: "set_goal_snapshot", payload: { threadId: activeThreadId, ...snapshot } });
              dispatch({
                type: "show_info_toast",
                payload: snapshot.goal
                  ? `Goal ${snapshot.goal.status}: ${snapshot.goal.objective}`
                  : "No goal is set for this thread.",
              });
            })
            .catch((cause) => {
              dispatch({
                type: "show_info_toast",
                payload: cause instanceof Error ? cause.message : String(cause),
              });
            });
          return;
        }
        case "mcp": {
          if (!rpc) {
            dispatch({ type: "show_info_toast", payload: "Not connected to the app server." });
            return;
          }
          const [sub, server] = (arg ?? "").trim().split(/\s+/).filter(Boolean);
          if (!sub || sub === "list") {
            openMcpModal();
            return;
          }
          if (sub === "login" || sub === "logout") {
            if (!server) {
              dispatch({ type: "show_info_toast", payload: `Usage: /mcp ${sub} <server>` });
              return;
            }
            if (sub === "login") {
              // Open the modal so the user sees the status flip once login completes, then let the
              // app-server open the browser and drive OAuth (completion arrives via notification).
              openMcpModal();
              dispatch({ type: "show_info_toast", payload: `Opening browser for "${server}" authorization…` });
              void rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.MCP_LOGIN_START, { server }).catch((cause) => {
                dispatch({
                  type: "show_info_toast",
                  payload: `Login failed for "${server}": ${cause instanceof Error ? cause.message : String(cause)}`,
                });
              });
              return;
            }
            void rpc
              .request(DILIGENT_CLIENT_REQUEST_METHODS.MCP_LOGOUT, { server })
              .then(() => {
                dispatch({ type: "show_info_toast", payload: `Cleared stored credentials for "${server}".` });
                bumpMcpRefreshNonce();
              })
              .catch((cause) => {
                dispatch({
                  type: "show_info_toast",
                  payload: `Logout failed for "${server}": ${cause instanceof Error ? cause.message : String(cause)}`,
                });
              });
            return;
          }
          dispatch({
            type: "show_info_toast",
            payload: "Usage: /mcp list | login <server> | logout <server>",
          });
          return;
        }
        case "reload": {
          if (!rpc) {
            dispatch({ type: "show_info_toast", payload: "Not connected to the app server." });
            return;
          }
          void rpc
            .request(DILIGENT_CLIENT_REQUEST_METHODS.CONFIG_RELOAD, {})
            .then((result) => {
              setSkills(result.skills);
              dispatch({ type: "show_info_toast", payload: "Reloaded config, skills, agents, tools & MCP servers." });
            })
            .catch((cause) => {
              dispatch({
                type: "show_info_toast",
                payload: `Reload failed: ${cause instanceof Error ? cause.message : String(cause)}`,
              });
            });
          return;
        }
        default: {
          const isSkill = slashCommands.some((command) => command.name === name && command.isSkill);
          if (isSkill && rpc && activeThreadId && stateRef.current.runtimeReady) {
            const message = arg ? `/${name} ${arg}` : `/${name}`;
            const localItemId = `local-user-${createUuidV4()}`;
            dispatch({ type: "local_user", payload: { id: localItemId, text: message, images: [] } });
            void rpc
              .request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_START, {
                threadId: activeThreadId,
                message,
                content: [{ type: "text" as const, text: message }],
              })
              .then((started) => {
                if (!started.userMessageId) return;
                dispatch({
                  type: "bind_user_message_id",
                  payload: { renderItemId: localItemId, messageId: started.userMessageId },
                });
              });
            return;
          }
          dispatch({ type: "show_info_toast", payload: `Unknown command: /${name}` });
        }
      }
    },
    [
      rpcRef,
      stateRef,
      state.activeThreadId,
      setMode,
      clearThreadInput,
      clearDraftInput,
      slashCommands,
      dispatch,
      startNewThread,
      openThread,
      openMcpModal,
      bumpMcpRefreshNonce,
      setSkills,
      availableModels,
      changeModel,
      effort,
      setEffortState,
      currentModel,
      setEffort,
      goalsSupported,
      modeRef,
      cwdRef,
      fastMode,
      activateServerThread,
      applySessionModel,
      currentModelRef,
      refreshThreadList,
      getNavigationGuard,
    ],
  );

  const handleSend = useCallback(() => {
    const parsedCommand = parseSlashCommand(activeInput);
    if (parsedCommand) {
      const command = slashCommands.find((item) => item.name === parsedCommand.name);
      if (command || parsedCommand.name === "goal") {
        handleSlashCommand(parsedCommand.name, parsedCommand.args);
        return;
      }
    }
    if (!stateRef.current.runtimeReady) return;
    void sendMessage();
  }, [activeInput, slashCommands, handleSlashCommand, sendMessage, stateRef]);

  const interruptRequestRef = useRef<{ threadId: string; turnId: string | null } | null>(null);
  const handleInterrupt = useCallback(() => {
    const rpc = rpcRef.current;
    const snapshot = stateRef.current;
    const threadId = snapshot.activeThreadId;
    if (!rpc || !threadId || (snapshot.threadStatus !== "busy" && snapshot.goal?.status !== "active")) return;
    const turnId = snapshot.activeTurnId;
    if (interruptRequestRef.current?.threadId === threadId && interruptRequestRef.current.turnId === turnId) return;
    const request = { threadId, turnId };
    const isCurrent = getNavigationGuard();
    interruptRequestRef.current = request;
    steeringControl.pendingAbortRestartSteerRef.current = snapshot.pendingSteers[0] ?? null;
    void (async () => {
      try {
        const result = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_INTERRUPT, { threadId });
        if (!result.interrupted) {
          if (interruptRequestRef.current === request) steeringControl.pendingAbortRestartSteerRef.current = null;
          if (isCurrent() && stateRef.current.activeThreadId === threadId && stateRef.current.activeTurnId === turnId) {
            await refreshThreadHistory(threadId);
          }
        }
      } catch (error) {
        if (interruptRequestRef.current === request) steeringControl.pendingAbortRestartSteerRef.current = null;
        logger.error("turn.interrupt_failed", {
          message: "[App] turn/interrupt failed:",
          error,
          threadId,
        });
      } finally {
        if (interruptRequestRef.current === request) interruptRequestRef.current = null;
      }
    })();
  }, [rpcRef, stateRef, steeringControl, refreshThreadHistory, getNavigationGuard]);

  const handleRetryLastTurn = useCallback(() => {
    void (async () => {
      const rpc = rpcRef.current;
      const snapshot = stateRef.current;
      const threadId = snapshot.activeThreadId;
      if (!rpc || !threadId || snapshot.threadStatus === "busy" || !snapshot.runtimeReady) return;
      const isCurrent = getNavigationGuard();
      try {
        const lastUser = snapshot.items.findLast((item) => item.kind === "user");
        if (lastUser?.kind !== "user") throw new Error("There is no previous request to retry.");
        await retryLastUserMessage({
          rpc,
          threadId,
          item: lastUser,
          model: currentModelRef.current,
          dispatch: (action) => {
            if (isCurrent()) dispatch(action);
          },
        });
      } catch (error) {
        if (!isCurrent()) return;
        logger.error("turn.retry_failed", { message: "Failed to retry the last turn", error, threadId });
        const reason = error instanceof Error ? error.message : String(error);
        dispatch({
          type: "client_error",
          payload: {
            id: `retry-error-${createUuidV4()}`,
            error: { name: "RetryFailed", message: reason, presentation: { message: `Retry failed: ${reason}` } },
          },
        });
      }
    })();
  }, [currentModelRef, dispatch, rpcRef, stateRef, getNavigationGuard]);

  const handleModeChange = useCallback(
    (mode: Mode) => {
      void setMode(mode);
    },
    [setMode],
  );

  const handleEffortChange = useCallback(
    (nextEffort: ThinkingEffort) => {
      void setEffort(nextEffort);
    },
    [setEffort],
  );

  const handleFastModeChange = useCallback(
    (nextFastMode: boolean) => {
      void (async () => {
        try {
          const rpc = rpcRef.current;
          if (state.activeThreadId) {
            if (!rpc) throw new Error("Not connected to the server.");
            await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.FAST_MODE_SET, {
              threadId: state.activeThreadId,
              fastMode: nextFastMode,
            });
          }
          if (stateRef.current.activeThreadId === state.activeThreadId) setFastModeState(nextFastMode);
        } catch (error) {
          dispatch({ type: "show_info_toast", payload: error instanceof Error ? error.message : String(error) });
        }
      })();
    },
    [rpcRef, stateRef, state.activeThreadId, setFastModeState, dispatch],
  );

  const handleModelChange = useCallback(
    (optionKey: string) => {
      const model = availableModels.find((candidate) => modelOptionKey(candidate) === optionKey);
      if (model) void changeModel(model, getModelChangeThreadId(state.activeThreadId));
    },
    [availableModels, changeModel, state.activeThreadId],
  );

  const handleGoalPause = useCallback(() => handleSlashCommand("goal", "pause"), [handleSlashCommand]);
  const handleGoalResume = useCallback(() => handleSlashCommand("goal", "resume"), [handleSlashCommand]);
  const handleGoalClear = useCallback(() => handleSlashCommand("goal", "clear"), [handleSlashCommand]);

  const handleAddImagesToDock = useCallback(
    (files: FileList | File[]) => {
      void handleAddImages(files);
    },
    [handleAddImages],
  );

  return {
    handleSend,
    handleInterrupt,
    handleRetryLastTurn,
    handleModeChange,
    handleEffortChange,
    handleFastModeChange,
    handleModelChange,
    handleCompactionClick,
    handleAddImagesToDock,
    handleRemovePendingImage,
    handleSlashCommand,
    handleGoalPause,
    handleGoalResume,
    handleGoalClear,
  };
}
