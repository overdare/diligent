// @summary Collab event block showing sub-agent orchestration, always collapsed by default

import { useState } from "react";
import { cn } from "../lib/cn";
import type { RenderItem } from "../lib/thread-store";
import { getToolInfo, summarizeInput, summarizeOutput } from "../lib/tool-info";
import { StatusDot } from "./StatusDot";

interface CollabEventBlockProps {
  item: Extract<RenderItem, { kind: "collab" }>;
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

export function CollabEventBlock({ item }: CollabEventBlockProps) {
  const icon = item.eventType === "spawn" ? "◈" : item.eventType === "wait" ? "⏳" : "✕";

  const hasRunningTool = item.childTools.some((t) => t.status === "running");

  const [expanded, setExpanded] = useState(false);

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

  // Count expandable detail items
  const detailCount = item.childTools.length + (item.childMessages?.length ?? 0);

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

          {/* Expandable detail section: tools + messages */}
          {detailCount > 0 && (
            <div className="mt-1.5 space-y-0.5">
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
                    const inputSummary = tool.inputText ? summarizeInput(tool.toolName, tool.inputText) : "";
                    const outputSummary =
                      tool.status === "done" && !tool.isError && tool.outputText
                        ? summarizeOutput(tool.toolName, tool.outputText)
                        : "";
                    return (
                      <div key={tool.toolCallId} className="flex flex-col gap-0.5 text-xs">
                        <div className="flex items-center gap-1.5">
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
                          {inputSummary ? (
                            <span className="max-w-[56ch] truncate font-mono text-text/30">{inputSummary}</span>
                          ) : null}
                          {isRunning && <StatusDot color="accent" pulse />}
                          {tool.isError && <span className="text-danger">✗</span>}
                        </div>
                        {outputSummary ? (
                          <div className="ml-8 flex items-center gap-1">
                            <span className="max-w-[56ch] truncate font-mono text-accent/50">↳ {outputSummary}</span>
                          </div>
                        ) : null}
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
