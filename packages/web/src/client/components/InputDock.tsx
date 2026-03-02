// @summary Input dock with auto-resize textarea, send/stop controls, and status tray

import type { Mode, ThreadStatus } from "@diligent/protocol";
import { useRef } from "react";
import type { ModelInfo } from "../../shared/ws-protocol";
import type { ConnectionState } from "../lib/rpc-client";
import type { UsageState } from "../lib/thread-store";
import { StatusDot } from "./StatusDot";
import { TextArea } from "./TextArea";

interface InputDockProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onInterrupt: () => void;
  canSend: boolean;
  threadStatus: ThreadStatus;
  connection: ConnectionState;
  cwd: string;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  currentModel: string;
  availableModels: ModelInfo[];
  onModelChange: (modelId: string) => void;
  usage: UsageState;
}

const CONNECTION_DOT: Record<ConnectionState, { color: "success" | "accent" | "danger"; pulse: boolean }> = {
  connected: { color: "success", pulse: false },
  connecting: { color: "accent", pulse: true },
  reconnecting: { color: "accent", pulse: true },
  disconnected: { color: "danger", pulse: false },
};

const MODE_LABELS: Record<Mode, string> = {
  default: "default",
  plan: "plan",
  execute: "execute",
};

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatUsageTooltip(usage: UsageState): string {
  return [
    `Input: ${usage.inputTokens.toLocaleString()}`,
    `Output: ${usage.outputTokens.toLocaleString()}`,
    `Cache read: ${usage.cacheReadTokens.toLocaleString()}`,
    `Cache write: ${usage.cacheWriteTokens.toLocaleString()}`,
    `Cost: $${usage.totalCost.toFixed(4)}`,
  ].join("\n");
}

function groupModelsByProvider(models: ModelInfo[]): Record<string, ModelInfo[]> {
  const groups: Record<string, ModelInfo[]> = {};
  for (const model of models) {
    if (!groups[model.provider]) groups[model.provider] = [];
    groups[model.provider].push(model);
  }
  return groups;
}

export function InputDock({
  input,
  onInputChange,
  onSend,
  onInterrupt,
  canSend,
  threadStatus,
  connection,
  cwd,
  mode,
  onModeChange,
  currentModel,
  availableModels,
  onModelChange,
  usage,
}: InputDockProps) {
  const composingRef = useRef(false);
  const isBusy = threadStatus === "busy";
  const totalTokens = usage.inputTokens + usage.outputTokens;
  const hasUsage = totalTokens > 0;

  return (
    <div className="border-t border-text/10 bg-surface/40 px-6 pb-3 pt-3">
      <div className="rounded-3xl border border-text/15 bg-bg/60 px-4 py-3 shadow-panel">
        {/* Textarea */}
        <TextArea
          className="min-h-[48px] border-0 bg-transparent px-0 py-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-transparent"
          aria-label="Message input"
          placeholder="Ask anything…"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
          }}
          onKeyDown={(e) => {
            // Prevent Korean/IME composition Enter from triggering submit.
            if (composingRef.current || e.nativeEvent.isComposing) {
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!isBusy) onSend();
            }
          }}
        />

        {/* Bottom bar (inside input panel) */}
        <div className="mt-3 flex items-center justify-between gap-3">
          {/* Left: connection + cwd + usage */}
          <div className="flex min-w-0 items-center gap-1.5 text-xs- text-muted">
            <StatusDot color={CONNECTION_DOT[connection].color} pulse={CONNECTION_DOT[connection].pulse} />
            <span className="shrink-0">{connection}</span>
            {cwd ? (
              <>
                <span className="opacity-30">·</span>
                <span className="min-w-0 truncate font-mono opacity-60" title={cwd}>
                  {cwd.split("/").slice(-2).join("/")}
                </span>
              </>
            ) : null}
            {hasUsage ? (
              <>
                <span className="opacity-30">·</span>
                <span className="shrink-0 cursor-default opacity-70" title={formatUsageTooltip(usage)}>
                  {formatTokenCount(totalTokens)} tokens · ${usage.totalCost.toFixed(2)}
                </span>
              </>
            ) : null}
          </div>

          {/* Right: model selector + mode selector + send/stop */}
          <div className="flex items-center gap-2">
            {availableModels.length > 0 ? (
              <select
                aria-label="Model selector"
                value={currentModel}
                onChange={(e) => onModelChange(e.target.value)}
                className="h-7 max-w-[180px] rounded-md border border-text/15 bg-bg px-2 text-xs text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
              >
                {Object.entries(groupModelsByProvider(availableModels)).map(([provider, models]) => (
                  <optgroup key={provider} label={provider}>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ) : null}

            <select
              aria-label="Mode selector"
              value={mode}
              onChange={(e) => onModeChange(e.target.value as Mode)}
              className="h-7 rounded-md border border-text/15 bg-bg px-2 text-xs text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            >
              {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>

            {isBusy ? (
              <button
                type="button"
                aria-label="Interrupt turn"
                onClick={onInterrupt}
                className="rounded-md border border-danger/30 bg-danger/10 px-3 py-1 text-xs text-danger transition hover:bg-danger/20"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                aria-label="Send message"
                onClick={() => {
                  if (!composingRef.current) onSend();
                }}
                disabled={!canSend}
                className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-bg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
