// @summary Collab event block showing sub-agent orchestration, always collapsed by default

import { useState } from "react";
import { cn } from "../lib/cn";
import type { RenderItem } from "../lib/thread-store";
import { getToolInfo } from "../lib/tool-info";
import { StatusDot } from "./StatusDot";

interface CollabEventBlockProps {
  item: Extract<RenderItem, { kind: "collab" }>;
}

function agentLabel(nickname?: string, threadId?: string): string {
  return nickname ?? threadId ?? "agent";
}

function formatAgentType(agentType?: string): string | null {
  if (!agentType) return null;
  return `[${agentType}]`;
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

export function CollabEventBlock({ item }: CollabEventBlockProps) {
  const iconMap: Record<string, string> = { spawn: "◈", wait: "⏳", close: "✕", interaction: "→" };
  const icon = iconMap[item.eventType] ?? "◈";

  const hasRunningTool = item.childTools.some((t) => t.status === "running");

  const [expanded, setExpanded] = useState(false);

  let title = "";
  let details: string | null = null;
  const agentTypeLabel = item.eventType === "spawn" ? formatAgentType(item.agentType) : null;

  switch (item.eventType) {
    case "spawn":
      title = `Spawned ${agentLabel(item.nickname, item.childThreadId)}${agentTypeLabel ? ` ${agentTypeLabel}` : ""}`;
      if (item.description) details = item.description;
      break;
    case "wait": {
      const count = item.agents?.length ?? 0;
      if (count === 1 && item.agents?.[0]) {
        title = `Finished waiting for ${agentLabel(item.agents[0].nickname, item.agents[0].threadId)}`;
      } else {
        title = `Finished waiting for ${count} agents`;
      }
      break;
    }
    case "close":
      title = `Closed ${agentLabel(item.nickname, item.childThreadId)}`;
      break;
    case "interaction":
      title = `Sent message to ${agentLabel(item.nickname, item.childThreadId)}`;
      break;
  }

  const badge = statusBadge(item.status);

  // For wait events, show per-agent status
  const agentStatuses = item.eventType === "wait" && item.agents && item.agents.length > 0;

  // Turn info for spawn items
  const turnInfo = item.eventType === "spawn" && item.turnNumber ? `turn ${item.turnNumber}` : null;

  // Count expandable detail items
  const detailCount = item.childTools.length + (item.childMessages?.length ?? 0) + (item.prompt ? 1 : 0);

  return (
    <div className="pb-4">
      <div className="flex items-start gap-3 rounded-2xl border border-border/10 bg-surface/28 px-4 py-3">
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
            <span className="text-sm font-medium text-text-soft">{title}</span>
            {badge && <span className={cn("text-xs", badge.className)}>{badge.text}</span>}
            {hasRunningTool && <StatusDot color="accent" pulse />}
            {turnInfo && <span className="text-xs text-text/30">{turnInfo}</span>}
            {item.timedOut && <span className="text-xs text-danger/70">timed out</span>}
          </div>

          {/* Description */}
          {details && <p className="mt-1 text-xs leading-5 text-text/55">{details}</p>}

          {/* Final message for non-wait events */}
          {item.message && !agentStatuses && (
            <p className="mt-1 max-w-[80ch] truncate text-xs text-text/50">{item.message}</p>
          )}

          {/* Per-agent status for wait events */}
          {agentStatuses && (
            <div className="mt-2 space-y-1">
              {item.agents!.map((agent) => {
                const aBadge = statusBadge(agent.status);
                return (
                  <div key={agent.threadId} className="flex items-center gap-1.5 text-xs">
                    <span className="text-text/40">└</span>
                    <span className="font-medium text-accent/80">{agentLabel(agent.nickname, agent.threadId)}</span>
                    {aBadge && <span className={aBadge.className}>{aBadge.text}</span>}
                    {agent.message && <span className="max-w-[60ch] truncate text-text/40">— {agent.message}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Expandable detail section: tools + messages */}
          {detailCount > 0 && (
            <div className="mt-2.5 space-y-1">
              {!expanded ? (
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="flex items-center gap-1.5 text-xs text-muted hover:text-accent"
                >
                  <span className="w-3 text-right text-text/25">├</span>
                  <span className="text-text/40">▸</span>
                  <span>{detailCount} items</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="flex items-center gap-1.5 text-xs text-muted hover:text-accent"
                  >
                    <span className="w-3 text-right text-text/25">├</span>
                    <span className="text-text/40">▾</span>
                    <span>{detailCount} items</span>
                  </button>
                  {item.prompt ? (
                    <div className="flex items-start gap-1.5 text-xs">
                      <span className="w-3 shrink-0 text-right text-text/25">├</span>
                      <span className="shrink-0 text-text/40">📝</span>
                      <span className="max-w-[80ch] whitespace-pre-wrap text-text/45">{item.prompt}</span>
                    </div>
                  ) : null}
                  {/* Child messages (assistant text from sub-agent) */}
                  {item.childMessages?.map((msg) => (
                    <div key={msg} className="flex items-start gap-1.5 text-xs">
                      <span className="w-3 shrink-0 text-right text-text/25">├</span>
                      <span className="shrink-0 text-text/40">💬</span>
                      <span className="max-w-[80ch] whitespace-pre-wrap text-text/50">{msg}</span>
                    </div>
                  ))}
                  {/* Child tool activity */}
                  {item.childTools.map((tool) => {
                    const info = getToolInfo(tool.toolName);
                    const isRunning = tool.status === "running";
                    return (
                      <div key={tool.toolCallId} className="flex flex-col gap-0.5 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="w-3 text-right text-text/25">├</span>
                          <span className={cn("leading-none", isRunning ? "text-text/70" : "text-text/40")}>
                            {info.displayName}
                          </span>
                          {isRunning && <StatusDot color="accent" pulse />}
                          {tool.isError && <span className="text-danger">✗</span>}
                        </div>
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
