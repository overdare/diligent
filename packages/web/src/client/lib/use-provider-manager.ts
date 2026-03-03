// @summary React hook for provider authentication state, available models, and OAuth

import type { ProviderAuthStatus } from "@diligent/protocol";
import type { RefObject } from "react";
import { useCallback, useRef, useState } from "react";
import type { ModelInfo, OAuthStartResult } from "../../shared/ws-protocol";
import { fetchProviderStatus, removeProviderKey, setProviderKey, startOAuthFlow } from "./auth-api";
import type { WebRpcClient } from "./rpc-client";

export function useProviderManager(rpcRef: RefObject<WebRpcClient | null>) {
  const [providers, setProviders] = useState<ProviderAuthStatus[]>([]);
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [currentModel, setCurrentModel] = useState<string>("");

  // Refs kept in sync so async callbacks always read the latest values
  const currentModelRef = useRef<string>("");
  currentModelRef.current = currentModel;
  const availableModelsRef = useRef<ModelInfo[]>([]);
  availableModelsRef.current = availableModels;

  // Syncs model (and optionally available models) into both state and refs immediately,
  // so subsequent async callbacks in the same chain see fresh values without waiting for re-render.
  const setInitialModel = useCallback((modelId: string, models?: ModelInfo[]): void => {
    setCurrentModel(modelId);
    currentModelRef.current = modelId;
    if (models !== undefined) {
      setAvailableModels(models);
      availableModelsRef.current = models;
    }
  }, []);

  const refreshProviders = useCallback(
    async (rpc = rpcRef.current): Promise<void> => {
      if (!rpc) return;
      try {
        const result = await fetchProviderStatus(rpc);
        setProviders(result.providers);
        setAvailableModels(result.availableModels);
        const modelInvalid =
          result.availableModels.length > 0 && !result.availableModels.some((m) => m.id === currentModelRef.current);
        if (modelInvalid) {
          const first = result.availableModels[0];
          setCurrentModel(first.id);
          await rpc.requestRaw("config/set", { model: first.id });
        }
      } catch (error) {
        console.error(error);
      }
    },
    [rpcRef],
  );

  // Finds the last assistant model in history and applies it if valid and different from current.
  // Caller must ensure availableModelsRef is populated before calling (via setInitialModel).
  const applySessionModel = useCallback(
    async (messages: { role: string; model?: string }[]): Promise<void> => {
      const rpc = rpcRef.current;
      if (!rpc) return;
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      const sessionModel = lastAssistant?.model;
      if (
        sessionModel &&
        sessionModel !== currentModelRef.current &&
        availableModelsRef.current.some((m) => m.id === sessionModel)
      ) {
        setCurrentModel(sessionModel);
        currentModelRef.current = sessionModel;
        await rpc.requestRaw("config/set", { model: sessionModel });
      }
    },
    [rpcRef],
  );

  const changeModel = useCallback(
    async (modelId: string): Promise<void> => {
      const rpc = rpcRef.current;
      if (!rpc) return;
      setCurrentModel(modelId);
      try {
        await rpc.requestRaw("config/set", { model: modelId });
      } catch (error) {
        console.error(error);
      }
    },
    [rpcRef],
  );

  const handleSetProviderKey = useCallback(
    async (provider: string, apiKey: string): Promise<void> => {
      const rpc = rpcRef.current;
      if (!rpc) return;
      await setProviderKey(rpc, provider, apiKey);
      // account/updated notification will update providers state
    },
    [rpcRef],
  );

  const handleRemoveProviderKey = useCallback(
    async (provider: string): Promise<void> => {
      const rpc = rpcRef.current;
      if (!rpc) return;
      await removeProviderKey(rpc, provider);
      // account/updated notification will update providers state
    },
    [rpcRef],
  );

  const handleOAuthStart = useCallback(async (): Promise<OAuthStartResult> => {
    const rpc = rpcRef.current;
    if (!rpc) throw new Error("Not connected");
    return startOAuthFlow(rpc);
  }, [rpcRef]);

  // Notification handlers: called from App.tsx when server pushes account notifications
  const onAccountLoginCompleted = useCallback(
    (params: { loginId: string | null; success: boolean; error: string | null }): void => {
      if (!params.success && params.error) {
        console.error("OAuth login failed:", params.error);
      }
      // Provider list update comes via onAccountUpdated
    },
    [],
  );

  const onAccountUpdated = useCallback(
    async (params: { providers: ProviderAuthStatus[] }): Promise<void> => {
      setProviders(params.providers);
      // Also refresh available models since provider configuration changed
      const rpc = rpcRef.current;
      if (!rpc) return;
      try {
        const result = await fetchProviderStatus(rpc);
        setAvailableModels(result.availableModels);
        const modelInvalid =
          result.availableModels.length > 0 && !result.availableModels.some((m) => m.id === currentModelRef.current);
        if (modelInvalid) {
          const first = result.availableModels[0];
          setCurrentModel(first.id);
          await rpc.requestRaw("config/set", { model: first.id });
        }
      } catch {
        // Non-critical: providers already updated via notification
      }
    },
    [rpcRef],
  );

  return {
    providers,
    availableModels,
    currentModel,
    currentModelRef,
    availableModelsRef,
    setInitialModel,
    refreshProviders,
    applySessionModel,
    changeModel,
    handleSetProviderKey,
    handleRemoveProviderKey,
    handleOAuthStart,
    onAccountLoginCompleted,
    onAccountUpdated,
  };
}
