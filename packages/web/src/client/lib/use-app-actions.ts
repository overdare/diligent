// @summary App action handlers for sending, image uploads, slash commands, and turn controls

import type { Mode, ModelInfo, ThinkingEffort } from "@diligent/protocol";
import { DILIGENT_CLIENT_REQUEST_METHODS } from "@diligent/protocol";
import { type Dispatch, type MutableRefObject, type RefObject, type SetStateAction, useCallback } from "react";
import type { AppAction, PendingImage } from "./app-state";
import { fileToBase64, normalizeImageFileName, replaceThreadUrl } from "./app-utils";
import { findModelInfo, getThinkingEffortUsage, supportsThinkingNone } from "./model-thinking-helpers";
import type { WebRpcClient } from "./rpc-client";
import { parseSlashCommand, type SlashCommand } from "./slash-commands";
import type { ThreadState } from "./thread-store";

type SteeringControl = {
  pendingAbortRestartMessageRef: MutableRefObject<string | null>;
  suppressNextSteeringInjectedRef: MutableRefObject<boolean>;
};

export function useAppActions({
  rpcRef,
  state,
  stateRef,
  dispatch,
  activeInput,
  pendingImages,
  canSend,
  isUploadingImages,
  isCompacting,
  supportsVision,
  effort,
  slashCommands,
  currentModel,
  availableModels,
  currentModelRef,
  clearThreadInput,
  setPendingImages,
  setIsUploadingImages,
  setIsCompacting,
  setEffortState,
  changeModel,
  startNewThread,
  openThread,
  steeringControl,
  modeRef,
  cwdRef,
  applySessionModel,
  activateServerThread,
  refreshThreadList,
}: {
  rpcRef: RefObject<WebRpcClient | null>;
  state: ThreadState;
  stateRef: RefObject<ThreadState>;
  dispatch: Dispatch<AppAction>;
  activeInput: string;
  pendingImages: PendingImage[];
  canSend: boolean;
  isUploadingImages: boolean;
  isCompacting: boolean;
  supportsVision: boolean;
  effort: ThinkingEffort;
  slashCommands: SlashCommand[];
  currentModel: string;
  availableModels: ModelInfo[];
  currentModelRef: RefObject<string>;
  clearThreadInput: (threadId: string) => void;
  setPendingImages: Dispatch<SetStateAction<PendingImage[]>>;
  setIsUploadingImages: Dispatch<SetStateAction<boolean>>;
  setIsCompacting: Dispatch<SetStateAction<boolean>>;
  setEffortState: Dispatch<SetStateAction<ThinkingEffort>>;
  changeModel: (modelId: string, threadId?: string) => Promise<void>;
  startNewThread: () => Promise<void>;
  openThread: (threadId: string) => Promise<void>;
  steeringControl: SteeringControl;
  modeRef: RefObject<Mode>;
  cwdRef: RefObject<string>;
  applySessionModel: (sessionModel?: string) => Promise<void>;
  activateServerThread: (threadId: string) => void;
  refreshThreadList: (rpc?: WebRpcClient | null) => Promise<void>;
}) {
  const sendMessage = useCallback(async (): Promise<void> => {
    const rpc = rpcRef.current;
    if (!rpc || !canSend) return;
    const message = activeInput.trim();
    const images = pendingImages;
    const existingThreadId = state.activeThreadId;
    if (existingThreadId) {
      clearThreadInput(existingThreadId);
    }
    setPendingImages([]);

    try {
      let threadId = existingThreadId;
      if (!threadId) {
        const started = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_START, {
          cwd: cwdRef.current || "/",
          mode: modeRef.current,
          model: currentModelRef.current || undefined,
        });
        threadId = started.threadId;
        const history = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, { threadId });
        dispatch({ type: "hydrate", payload: { threadId, mode: modeRef.current, history } });
        if (typeof window !== "undefined") {
          replaceThreadUrl(threadId);
        }
        activateServerThread(threadId);
        await applySessionModel(history.currentModel);
      }

      dispatch({ type: "local_user", payload: { text: message, images } });

      if (state.items.length === 0 && threadId) {
        dispatch({
          type: "optimistic_thread",
          payload: { threadId, message: message || "[image]" },
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
      await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_START, {
        threadId,
        message,
        attachments: images.map((image) => ({
          type: "local_image" as const,
          path: image.path,
          mediaType: image.mediaType,
          fileName: image.fileName,
        })),
        content,
        model: currentModelRef.current || undefined,
      });
      await refreshThreadList(rpc);
    } catch (error) {
      console.error(error);
    }
  }, [
    rpcRef,
    state,
    canSend,
    activeInput,
    pendingImages,
    clearThreadInput,
    setPendingImages,
    dispatch,
    currentModelRef,
    modeRef,
    cwdRef,
    applySessionModel,
    activateServerThread,
    refreshThreadList,
  ]);

  const setMode = useCallback(
    async (mode: Mode): Promise<void> => {
      const rpc = rpcRef.current;
      if (!rpc || !state.activeThreadId) return;
      await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.MODE_SET, { threadId: state.activeThreadId, mode });
      dispatch({ type: "set_mode", payload: mode });
    },
    [rpcRef, state.activeThreadId, dispatch],
  );

  const setEffort = useCallback(
    async (nextEffort: ThinkingEffort): Promise<void> => {
      const rpc = rpcRef.current;
      if (!rpc || !state.activeThreadId) return;
      const modelInfo = findModelInfo(availableModels, currentModel);
      if (nextEffort === "none" && modelInfo?.supportsThinking && !supportsThinkingNone(modelInfo)) {
        dispatch({ type: "show_info_toast", payload: "This model does not support minimal thinking." });
        return;
      }
      await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.EFFORT_SET, {
        threadId: state.activeThreadId,
        effort: nextEffort,
      });
      setEffortState(nextEffort);
    },
    [rpcRef, state.activeThreadId, availableModels, currentModel, dispatch, setEffortState],
  );

  const handleCompactionClick = useCallback(() => {
    void (async () => {
      const rpc = rpcRef.current;
      if (!rpc || !state.activeThreadId || isCompacting) return;
      setIsCompacting(true);
      dispatch({ type: "show_info_toast", payload: "Manual compaction in progress…" });
      try {
        await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_COMPACT_START, { threadId: state.activeThreadId });
        const history = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_READ, {
          threadId: state.activeThreadId,
        });
        dispatch({ type: "hydrate", payload: { threadId: state.activeThreadId, mode: state.mode, history } });
        dispatch({ type: "show_info_toast", payload: "Thread compacted." });
      } catch (error) {
        dispatch({
          type: "show_info_toast",
          payload: error instanceof Error ? error.message : "Manual compaction failed.",
        });
      } finally {
        setIsCompacting(false);
      }
    })();
  }, [rpcRef, state.activeThreadId, state.mode, isCompacting, setIsCompacting, dispatch]);

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
      const uploaded: PendingImage[] = [];
      const uploadTimestamp = Date.now();

      setIsUploadingImages(true);
      try {
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

          const dataBase64 = await fileToBase64(file);
          const result = await rpc.webRequest(DILIGENT_CLIENT_REQUEST_METHODS.IMAGE_UPLOAD, {
            threadId: state.activeThreadId ?? undefined,
            fileName: normalizedFileName,
            mediaType: file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
            dataBase64,
          });
          uploaded.push(result.attachment as PendingImage);
        }

        setPendingImages((previous) => [...previous, ...uploaded]);
      } catch (error) {
        dispatch({ type: "show_info_toast", payload: "Failed to upload images." });
        console.error(error);
      } finally {
        setIsUploadingImages(false);
      }
    },
    [
      rpcRef,
      isUploadingImages,
      pendingImages.length,
      supportsVision,
      setIsUploadingImages,
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

          const exists = availableModels.some((model) => model.id === arg);
          if (!exists) {
            dispatch({ type: "show_info_toast", payload: `Unknown model: ${arg}` });
            return;
          }

          void changeModel(arg).then(() => {
            const modelInfo = availableModels.find((model) => model.id === arg);
            if (effort === "none" && modelInfo && !supportsThinkingNone(modelInfo)) {
              setEffortState("medium");
              dispatch({ type: "show_info_toast", payload: `Model switched to ${arg}. Thinking adjusted to medium.` });
              return;
            }
            dispatch({ type: "show_info_toast", payload: `Model switched to ${arg}` });
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
          const normalized = arg.toLowerCase() === "minimal" ? "none" : arg.toLowerCase();
          if (!["none", "low", "medium", "high", "max"].includes(normalized)) {
            dispatch({ type: "show_info_toast", payload: `Unknown effort: ${arg}. Usage: ${usage}` });
            return;
          }
          void setEffort(normalized as ThinkingEffort);
          return;
        }
        default: {
          const isSkill = slashCommands.some((command) => command.name === name && command.isSkill);
          if (isSkill && rpc && activeThreadId) {
            const message = arg ? `/${name} ${arg}` : `/${name}`;
            dispatch({ type: "local_user", payload: { text: message, images: [] } });
            void rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_START, {
              threadId: activeThreadId,
              message,
              content: [{ type: "text" as const, text: message }],
            });
            return;
          }
          dispatch({ type: "show_info_toast", payload: `Unknown command: /${name}` });
        }
      }
    },
    [
      rpcRef,
      state.activeThreadId,
      clearThreadInput,
      slashCommands,
      dispatch,
      startNewThread,
      openThread,
      availableModels,
      changeModel,
      effort,
      setEffortState,
      currentModel,
      setEffort,
    ],
  );

  const handleSend = useCallback(() => {
    const parsedCommand = parseSlashCommand(activeInput);
    if (parsedCommand) {
      const command = slashCommands.find((item) => item.name === parsedCommand.name);
      if (command) {
        handleSlashCommand(parsedCommand.name, parsedCommand.args);
        return;
      }
    }
    void sendMessage();
  }, [activeInput, slashCommands, handleSlashCommand, sendMessage]);

  const handleInterrupt = useCallback(() => {
    void (async () => {
      const rpc = rpcRef.current;
      const threadId = state.activeThreadId;
      if (!rpc || !threadId) return;
      steeringControl.pendingAbortRestartMessageRef.current = stateRef.current.pendingSteers[0] ?? null;
      steeringControl.suppressNextSteeringInjectedRef.current =
        steeringControl.pendingAbortRestartMessageRef.current !== null;
      console.log("[App] Stop pressed — sending turn/interrupt for thread", threadId);
      try {
        const result = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.TURN_INTERRUPT, { threadId });
        console.log("[App] turn/interrupt response:", result);
      } catch (error) {
        steeringControl.pendingAbortRestartMessageRef.current = null;
        steeringControl.suppressNextSteeringInjectedRef.current = false;
        console.error("[App] turn/interrupt failed:", error);
      }
    })();
  }, [rpcRef, state.activeThreadId, stateRef, steeringControl]);

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

  const handleModelChange = useCallback(
    (modelId: string) => {
      void changeModel(modelId);
    },
    [changeModel],
  );

  const handleAddImagesToDock = useCallback(
    (files: FileList | File[]) => {
      void handleAddImages(files);
    },
    [handleAddImages],
  );

  return {
    handleSend,
    handleInterrupt,
    handleModeChange,
    handleEffortChange,
    handleModelChange,
    handleCompactionClick,
    handleAddImagesToDock,
    handleRemovePendingImage,
    handleSlashCommand,
  };
}
