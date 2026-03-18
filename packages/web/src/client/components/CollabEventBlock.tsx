// @summary Collab event block showing sub-agent orchestration in concise conversation order

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

function truncateUnicode(value: string, maxChars: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxChars) return value;
  return `${chars.slice(0, maxChars).join("")}…`;
}

function summarizeRequest(inputText: string): string {
  const trimmed = inputText.trim();
  if (!trimmed) return "(empty request)";
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const entries = Object.entries(parsed);
    if (entries.length === 0) return "{}";
    const preview = entries
      .slice(0, 3)
      .map(([key, value]) => {
        if (typeof value === "string") return `${key}=${value}`;
        if (typeof value === "number" || typeof value === "boolean") return `${key}=${String(value)}`;
        if (Array.isArray(value)) return `${key}=[${value.length}]`;
        if (value && typeof value === "object") return `${key}={...}`;
        return key;
      })
      .join(", ");
    return truncateUnicode(preview, 180);
  } catch {
    return truncateUnicode(trimmed.split("\n")[0] ?? trimmed, 180);
  }
}

function summarizeResponse(outputText: string): string {
  const trimmed = outputText.trim();
  if (!trimmed) return "(empty response)";
  return truncateUnicode(trimmed.split("\n")[0] ?? trimmed, 180);
}

function summarizeAssistantMessage(rawMessage: string): string | null {
  const trimmed = rawMessage.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed) as {
      content?: Array<{ type?: string; text?: string; thinking?: string }>;
    };
    const blocks = parsed.content;
    if (!Array.isArray(blocks)) return truncateUnicode(trimmed, 260);

    const text = blocks
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text!.trim())
      .filter((part) => part.length > 0)
      .join(" ");
    if (text) return truncateUnicode(text, 260);

    const thinking = blocks
      .filter((block) => block.type === "thinking" && typeof block.thinking === "string")
      .map((block) => block.thinking!.trim())
      .filter((part) => part.length > 0)
      .join(" ");
    if (thinking) return truncateUnicode(thinking, 200);

    return null;
  } catch {
    return truncateUnicode(trimmed, 260);
  }
}

export function CollabEventBlock({ item }: CollabEventBlockProps) {
  const [open, setOpen] = useState(false);
  const hasRunningTool = item.childTools.some((tool) => tool.status === "running");
  const badge = statusBadge(item.status);
  const turnInfo = item.eventType === "spawn" && item.turnNumber ? `turn ${item.turnNumber}` : null;

  let title = "";
  let details: string | null = null;
  const agentTypeLabel = item.eventType === "spawn" ? formatAgentType(item.agentType) : null;

  switch (item.eventType) {
    case "spawn":
      title = `Spawned ${agentLabel(item.nickname, item.childThreadId)}${agentTypeLabel ? ` ${agentTypeLabel}` : ""}`;
      details = item.description ?? null;
      break;
    case "wait": {
      const count = item.agents?.length ?? 0;
      title =
        count === 1 && item.agents?.[0]
          ? `Finished waiting for ${agentLabel(item.agents[0].nickname, item.agents[0].threadId)}`
          : `Finished waiting for ${count} agents`;
      break;
    }
    case "close":
      title = `Closed ${agentLabel(item.nickname, item.childThreadId)}`;
      break;
    case "interaction":
      title = `Sent message to ${agentLabel(item.nickname, item.childThreadId)}`;
      break;
  }

  const timeline = item.childTimeline ?? [];
  const hasBody = Boolean(
    details || item.message || (item.eventType === "wait" && item.agents?.length) || timeline.length > 0,
  );

  return (
    <div className="pb-4">
      <div className="min-w-0 rounded-xl bg-surface-dark py-2.5">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-medium text-text-soft">{title}</span>
            {badge && <span className={cn("text-xs", badge.className)}>{badge.text}</span>}
            {hasRunningTool && <StatusDot color="accent" pulse />}
            {turnInfo && <span className="text-xs text-text/40">{turnInfo}</span>}
            {item.timedOut && <span className="text-xs text-danger/80">timed out</span>}
          </div>

          {hasBody ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="-mt-1 w-fit text-2xs text-muted hover:text-accent"
            >
              {open ? "▾ collapse" : "▸ expand"}
            </button>
          ) : null}

          {open ? (
            <>
              {details ? <p className="text-xs leading-5 text-text/60">{details}</p> : null}

              {item.message ? <p className="text-xs text-text/65">{truncateUnicode(item.message, 240)}</p> : null}

              {item.eventType === "wait" && item.agents?.length ? (
                <div className="space-y-1">
                  {item.agents.map((agent) => {
                    const agentStatus = statusBadge(agent.status);
                    return (
                      <div key={agent.threadId} className="text-xs text-text/60">
                        {agentLabel(agent.nickname, agent.threadId)}
                        {agentStatus ? (
                          <span className={cn("ml-2", agentStatus.className)}>{agentStatus.text}</span>
                        ) : null}
                        {agent.message ? (
                          <span className="ml-2 text-text/45">- {truncateUnicode(agent.message, 140)}</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {timeline.length > 0 ? (
                <div className="space-y-1 text-xs">
                  {timeline.map((entry, index) => {
                    if (entry.kind === "assistant") {
                      const summary = summarizeAssistantMessage(entry.message);
                      if (!summary) return null;
                      return (
                        <div key={`${item.id}:timeline:assistant:${index}`} className="text-text/70">
                          {summary}
                        </div>
                      );
                    }

                    const info = getToolInfo(entry.toolName);
                    const req = summarizeRequest(entry.inputText);
                    const res = summarizeResponse(entry.outputText);
                    return (
                      <div key={`${item.id}:timeline:tool:${entry.toolCallId}`} className="font-mono">
                        <div className="text-text/60">
                          {info.displayName} - {req}
                        </div>
                        <div className="text-text/45">ㄴ {res}</div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
