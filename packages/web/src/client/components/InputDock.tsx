// @summary Input dock with auto-resize textarea, send/stop controls, and status tray

import type { Mode, ThreadStatus } from "@diligent/protocol";
import type { ConnectionState } from "../lib/rpc-client";
import { Button } from "./Button";
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
}

const CONNECTION_COLORS: Record<ConnectionState, string> = {
  connected: "bg-success",
  connecting: "bg-accent",
  reconnecting: "bg-accent animate-pulse",
  disconnected: "bg-danger",
};

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
}: InputDockProps) {
  const isBusy = threadStatus === "busy";

  return (
    <div className="border-t border-text/10 bg-bg/60 px-3 py-3">
      <div className="flex items-end gap-2">
        <TextArea
          aria-label="Message input"
          placeholder="Ask anything…"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        {isBusy ? (
          <Button aria-label="Interrupt turn" intent="ghost" onClick={onInterrupt}>
            Stop
          </Button>
        ) : (
          <Button aria-label="Send message" onClick={onSend} disabled={!canSend}>
            Send
          </Button>
        )}
      </div>

      {/* Status tray */}
      <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CONNECTION_COLORS[connection]}`} />
          <span className="shrink-0">{connection}</span>
          {cwd ? <span className="mx-1 opacity-30">·</span> : null}
          <span className="min-w-0 truncate opacity-70">{cwd}</span>
        </div>
        <select
          aria-label="Mode selector"
          value={mode}
          onChange={(e) => onModeChange(e.target.value as Mode)}
          className="h-6 rounded border border-text/15 bg-bg px-1.5 text-[11px] text-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          <option value="default">default</option>
          <option value="plan">plan</option>
          <option value="execute">execute</option>
        </select>
      </div>
    </div>
  );
}
