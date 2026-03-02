// @summary Modal for managing provider API keys and ChatGPT OAuth (connect/disconnect per provider)
import { useCallback, useEffect, useRef, useState } from "react";
import type { OAuthStatusResult, ProviderAuthStatus } from "../../shared/ws-protocol";
import { Button } from "./Button";
import { Input } from "./Input";
import { Modal } from "./Modal";
import { StatusDot } from "./StatusDot";

interface ProviderSettingsModalProps {
  providers: ProviderAuthStatus[];
  onSet: (provider: string, apiKey: string) => Promise<void>;
  onRemove: (provider: string) => Promise<void>;
  onOAuthStart: () => Promise<{ authUrl: string }>;
  onOAuthStatus: () => Promise<OAuthStatusResult>;
  onClose: () => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
};

export function ProviderSettingsModal({
  providers,
  onSet,
  onRemove,
  onOAuthStart,
  onOAuthStatus,
  onClose,
}: ProviderSettingsModalProps) {
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthStatus, setOAuthStatus] = useState<OAuthStatusResult["status"]>("idle");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return stopPolling;
  }, [stopPolling]);

  const handleSave = async (provider: string) => {
    if (!keyInput.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onSet(provider, keyInput.trim());
      setEditingProvider(null);
      setKeyInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save key");
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async (provider: string) => {
    setSaving(true);
    setError(null);
    try {
      await onRemove(provider);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove key");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingProvider(null);
    setKeyInput("");
    setError(null);
  };

  const handleOAuthStart = async () => {
    setSaving(true);
    setError(null);
    setOAuthStatus("pending");
    try {
      const { authUrl } = await onOAuthStart();
      window.open(authUrl, "_blank", "noopener");

      pollRef.current = setInterval(async () => {
        try {
          const result = await onOAuthStatus();
          if (result.status === "completed") {
            setOAuthStatus("completed");
            stopPolling();
            setSaving(false);
          } else if (result.status === "expired") {
            setOAuthStatus("idle");
            setError(result.error ?? "OAuth flow timed out");
            stopPolling();
            setSaving(false);
          }
        } catch {
          // Polling error — keep trying
        }
      }, 2000);
    } catch (e) {
      setOAuthStatus("idle");
      setError(e instanceof Error ? e.message : "Failed to start OAuth");
      setSaving(false);
    }
  };

  const isConnected = (p: ProviderAuthStatus) => p.configured || p.oauthConnected;

  return (
    <Modal title="Providers" description="Manage API keys for each provider.">
      <div className="space-y-3">
        {providers.map((p) => (
          <div key={p.provider} className="rounded-md border border-text/10 px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <StatusDot color={isConnected(p) ? "success" : "danger"} size="md" />
              <span className="flex-1 text-sm font-medium text-text">{PROVIDER_LABELS[p.provider] ?? p.provider}</span>
              {p.maskedKey ? <span className="font-mono text-xs text-muted">{p.maskedKey}</span> : null}
              {p.oauthConnected ? <span className="font-mono text-xs text-muted">ChatGPT</span> : null}
              {editingProvider !== p.provider && oauthStatus !== "pending" ? (
                isConnected(p) ? (
                  <Button
                    intent="ghost"
                    size="sm"
                    disabled={saving}
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
                    disabled={saving || !keyInput.trim()}
                    onClick={() => void handleSave(p.provider)}
                  >
                    Save
                  </Button>
                  <Button intent="ghost" size="sm" disabled={saving} onClick={handleCancel}>
                    Cancel
                  </Button>
                </div>
                {p.provider === "openai" ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted">or</span>
                    <Button
                      intent="ghost"
                      size="sm"
                      disabled={saving || oauthStatus === "pending"}
                      onClick={() => void handleOAuthStart()}
                    >
                      {oauthStatus === "pending" ? "Waiting for login..." : "Login with ChatGPT"}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {p.provider === "openai" && oauthStatus === "pending" && editingProvider !== p.provider ? (
              <div className="mt-2 flex items-center gap-2">
                <span className="animate-pulse text-xs text-accent">Waiting for ChatGPT login...</span>
              </div>
            ) : null}

            {p.provider === "openai" && oauthStatus === "completed" ? (
              <div className="mt-2 text-xs text-success">ChatGPT connected successfully!</div>
            ) : null}
          </div>
        ))}

        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>

      <div className="mt-4 flex justify-end">
        <Button intent="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
