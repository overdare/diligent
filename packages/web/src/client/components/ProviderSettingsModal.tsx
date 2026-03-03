// @summary Modal for managing provider API keys and ChatGPT OAuth (connect/disconnect per provider)
import { useCallback, useState } from "react";
import type { ProviderAuthStatus } from "@diligent/protocol";
import { Button } from "./Button";
import { Input } from "./Input";
import { Modal } from "./Modal";
import { StatusDot } from "./StatusDot";

interface ProviderSettingsModalProps {
  providers: ProviderAuthStatus[];
  focusProvider?: string;
  oauthPending: boolean;
  oauthError: string | null;
  onSet: (provider: string, apiKey: string) => Promise<void>;
  onRemove: (provider: string) => Promise<void>;
  onOAuthStart: () => Promise<{ authUrl: string }>;
  onClose: () => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
};

export function ProviderSettingsModal({
  providers,
  focusProvider,
  oauthPending,
  oauthError,
  onSet,
  onRemove,
  onOAuthStart,
  onClose,
}: ProviderSettingsModalProps) {
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [savingProvider, setSavingProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async (provider: string) => {
    if (!keyInput.trim()) return;
    setSavingProvider(provider);
    setError(null);
    try {
      await onSet(provider, keyInput.trim());
      setEditingProvider(null);
      setKeyInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save key");
    } finally {
      setSavingProvider(null);
    }
  };

  const handleDisconnect = async (provider: string) => {
    setSavingProvider(provider);
    setError(null);
    try {
      await onRemove(provider);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove key");
    } finally {
      setSavingProvider(null);
    }
  };

  const handleCancel = () => {
    setEditingProvider(null);
    setKeyInput("");
    setError(null);
  };

  const handleOAuthStart = useCallback(async () => {
    setSavingProvider("openai");
    setError(null);
    try {
      const { authUrl } = await onOAuthStart();
      window.open(authUrl, "_blank", "noopener");
      // account/login/completed notification will signal completion
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start OAuth");
      setSavingProvider(null);
    }
  }, [onOAuthStart]);

  const isConnected = (p: ProviderAuthStatus) => p.configured || p.oauthConnected;

  // Display combined error from local state or OAuth notification
  const displayError = error || oauthError;

  return (
    <Modal title="Providers" description="Manage API keys for each provider.">
      <div className="space-y-3">
        {providers.map((p) => {
          const isSaving = savingProvider === p.provider;
          const isFocused = focusProvider === p.provider;
          return (
            <div
              key={p.provider}
              className={`rounded-md border px-3 py-2.5 ${isFocused ? "border-accent/40 bg-accent/5" : "border-text/10"}`}
            >
              <div className="flex items-center gap-2.5">
                <StatusDot color={isConnected(p) ? "success" : "danger"} size="md" />
                <span className="flex-1 text-sm font-medium text-text">
                  {PROVIDER_LABELS[p.provider] ?? p.provider}
                </span>
                {p.maskedKey ? <span className="font-mono text-xs text-muted">{p.maskedKey}</span> : null}
                {p.oauthConnected ? <span className="font-mono text-xs text-muted">ChatGPT</span> : null}
                {editingProvider !== p.provider && !oauthPending ? (
                  isConnected(p) || isSaving ? (
                    <Button
                      intent="ghost"
                      size="sm"
                      disabled={isSaving}
                      onClick={() => void handleDisconnect(p.provider)}
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      intent="ghost"
                      size="sm"
                      onClick={() => {
                        setEditingProvider(p.provider);
                        setKeyInput("");
                        setError(null);
                      }}
                    >
                      Connect
                    </Button>
                  )
                ) : null}
              </div>

              {editingProvider === p.provider ? (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      type="password"
                      placeholder="API key"
                      className="h-8"
                      value={keyInput}
                      onChange={(e) => setKeyInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleSave(p.provider);
                        if (e.key === "Escape") handleCancel();
                      }}
                      autoFocus
                    />
                    <Button
                      size="sm"
                      disabled={isSaving || !keyInput.trim()}
                      onClick={() => void handleSave(p.provider)}
                    >
                      Save
                    </Button>
                    <Button intent="ghost" size="sm" disabled={isSaving} onClick={handleCancel}>
                      Cancel
                    </Button>
                  </div>
                  {p.provider === "openai" ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted">or</span>
                      <Button
                        intent="ghost"
                        size="sm"
                        disabled={isSaving || oauthPending}
                        onClick={() => void handleOAuthStart()}
                      >
                        {oauthPending ? "Waiting for login..." : "Login with ChatGPT"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {p.provider === "openai" && oauthPending && editingProvider !== p.provider ? (
                <div className="mt-2 flex items-center gap-2">
                  <span className="animate-pulse text-xs text-accent">Waiting for ChatGPT login...</span>
                </div>
              ) : null}
            </div>
          );
        })}

        {displayError ? <p className="text-sm text-danger">{displayError}</p> : null}
      </div>

      <div className="mt-4 flex justify-end">
        <Button intent="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
