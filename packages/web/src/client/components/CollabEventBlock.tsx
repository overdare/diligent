// @summary Collab event block showing sub-agent orchestration and internal tool activity

import { useEffect, useState } from "react";
import { cn } from "../lib/cn";
import type { RenderItem } from "../lib/thread-store";
import { getToolInfo } from "../lib/tool-info";
import { StatusDot } from "./StatusDot";

interface CollabEventBlockProps {
  item: Extract<RenderItem, { kind: "collab" }>;
  defaultCollapsed?: boolean;
}

function agentLabel(nickname?: string, agentId?: string): string {
  return nickname ?? agentId ?? "agent";
}

function statusBadge(status?: string): { text: string; className: string } | null {
  switch (status) {
    case "completed":
      return { text: "completed", className: "text-success" };
    case "errored":
      return { text: "error", className: "text-danger" };
    case "running":
      return { text: "running", className: "text-accent" };
    case "shutdown":
      return { text: "shutdown", className: "text-muted" };
    default:
      return null;
  }
}

export function CollabEventBlock({ item, defaultCollapsed = false }: CollabEventBlockProps) {
  const icon = item.eventType === "spawn" ? "◈" : item.eventType === "wait" ? "⏳" : "✕";

  const hasRunningTool = item.childTools.some((t) => t.status === "running");

  const [toolsCollapsed, setToolsCollapsed] = useState(defaultCollapsed);

  // Auto-expand when a tool is running; re-collapse when it stops if defaultCollapsed
  useEffect(() => {
    if (hasRunningTool) {
      setToolsCollapsed(false);
    } else if (defaultCollapsed) {
      setToolsCollapsed(true);
    }
  }, [hasRunningTool, defaultCollapsed]);

  let title: string;
  let details: string | null = null;

  switch (item.eventType) {
    case "spawn":
      title = `Spawned ${agentLabel(item.nickname, item.agentId)}`;
      if (item.description) details = item.description;
      break;
    case "wait": {
      const count = item.agents?.length ?? 0;
      if (count === 1 && item.agents?.[0]) {
        title = `Finished waiting for ${agentLabel(item.agents[0].nickname, item.agents[0].agentId)}`;
      } else {
        title = `Finished waiting for ${count} agents`;
      }
      break;
    }
    case "close":
      title = `Closed ${agentLabel(item.nickname, item.agentId)}`;
      break;
  }

  const badge = statusBadge(item.status);

  // For wait events, show per-agent status
  const agentStatuses = item.eventType === "wait" && item.agents && item.agents.length > 0;

  // Turn info for spawn items
  const turnInfo = item.eventType === "spawn" && item.turnNumber ? `turn ${item.turnNumber}` : null;

  return (
    <div className="pb-4">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "inline-flex h-4 w-4 shrink-0 items-center justify-center font-mono text-sm",
            hasRunningTool ? "text-accent" : "text-muted",
          )}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          {/* Header row */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted">{title}</span>
            {badge && <span className={cn("text-xs", badge.className)}>{badge.text}</span>}
            {hasRunningTool && <StatusDot color="accent" pulse />}
            {turnInfo && <span className="text-xs text-text/30">{turnInfo}</span>}
            {item.timedOut && <span className="text-xs text-danger/70">timed out</span>}
          </div>

          {/* Description */}
          {details && <p className="mt-0.5 text-xs text-text/50">{details}</p>}

          {/* Final message for non-wait events */}
          {item.message && !agentStatuses && (
            <p className="mt-0.5 max-w-[80ch] truncate text-xs text-text/50">{item.message}</p>
          )}

          {/* Per-agent status for wait events */}
          {agentStatuses && (
            <div className="mt-1 space-y-0.5">
              {item.agents!.map((agent) => {
                const aBadge = statusBadge(agent.status);
                return (
                  <div key={agent.agentId} className="flex items-center gap-1.5 text-xs">
                    <span className="text-text/40">└</span>
                    <span className="font-medium text-accent/80">{agentLabel(agent.nickname, agent.agentId)}</span>
                    {aBadge && <span className={aBadge.className}>{aBadge.text}</span>}
                    {agent.message && <span className="max-w-[60ch] truncate text-text/40">— {agent.message}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Child tool activity list */}
          {item.childTools.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {toolsCollapsed ? (
                <button
                  type="button"
                  onClick={() => setToolsCollapsed(false)}
                  className="flex items-center gap-1.5 text-xs text-muted hover:text-accent"
                >
                  <span className="w-3 text-right text-text/25">├</span>
                  <span className="text-text/40">▸</span>
                  <span>{item.childTools.length} tools</span>
                </button>
              ) : (
                <>
                  {defaultCollapsed && (
                    <button
                      type="button"
                      onClick={() => setToolsCollapsed(true)}
                      className="flex items-center gap-1.5 text-xs text-muted hover:text-accent"
                    >
                      <span className="w-3 text-right text-text/25">├</span>
                      <span className="text-text/40">▾</span>
                      <span>{item.childTools.length} tools</span>
                    </button>
                  )}
                  {item.childTools.map((tool) => {
                    const info = getToolInfo(tool.toolName);
                    const isRunning = tool.status === "running";
                    return (
                      <div key={tool.toolCallId} className="flex items-center gap-1.5 text-xs">
                        <span className="w-3 text-right text-text/25">├</span>
                        <span
                          className={cn(
                            "inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center font-mono text-[10px] leading-none",
                            isRunning ? "text-accent" : tool.isError ? "text-danger" : "text-text/40",
                          )}
                        >
                          {info.icon}
                        </span>
                        <span className={cn("leading-none", isRunning ? "text-text/70" : "text-text/40")}>
                          {info.displayName}
                        </span>
                        {isRunning && <StatusDot color="accent" pulse />}
                        {tool.isError && <span className="text-danger">✗</span>}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
