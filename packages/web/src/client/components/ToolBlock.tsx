// @summary Tool call block with icon, summary header, and tool-type-specific expandable content

import { useState } from "react";
import { cn } from "../lib/cn";
import type { RenderItem } from "../lib/thread-store";
import {
  formatToolDurationMs,
  getToolHeaderTitle,
  getToolInfo,
  summarizeInput,
  summarizeOutput,
} from "../lib/tool-info";
import { ContentBash } from "./ContentBash";
import { ContentEdit } from "./ContentEdit";
import { ContentRead } from "./ContentRead";
import { ContentText } from "./ContentText";
import { ToolRenderBlocks } from "./ToolRenderBlocks";
import { StatusDot } from "./StatusDot";

interface ToolBlockProps {
  item: Extract<RenderItem, { kind: "tool" }>;
}

/* ── Input JSON parsing helpers ───────────────────────────────────── */

function safeParse(inputText: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(inputText) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/* ── Tool-specific expanded content ───────────────────────────────── */

function ToolContent({ item }: { item: Extract<RenderItem, { kind: "tool" }> }) {
  // P040: Structured render payload takes priority for any tool (built-in or plugin).
  // Tools that return `render` explicitly opt into block-based rendering.
  // Tools without `render` fall through to name-based specialized renderers below.
  if (item.render) {
    return (
      <div className="space-y-3">
        <ToolRenderBlocks payload={item.render} />
      </div>
    );
  }

  const name = item.toolName.toLowerCase();
  const parsed = safeParse(item.inputText);

  // Bash → terminal
  if (name === "bash") {
    return <ContentBash command={str(parsed?.command)} output={item.outputText || undefined} isError={item.isError} />;
  }

  // Read → file viewer
  if (name === "read") {
    return (
      <ContentRead
        filePath={str(parsed?.file_path)}
        offset={num(parsed?.offset)}
        limit={num(parsed?.limit)}
        output={item.outputText || undefined}
        isError={item.isError}
      />
    );
  }

  // Edit / MultiEdit → diff view
  if (name === "edit" || name === "multiedit") {
    return (
      <ContentEdit
        filePath={str(parsed?.file_path)}
        mode="edit"
        oldString={str(parsed?.old_string)}
        newString={str(parsed?.new_string)}
        output={item.outputText || undefined}
        isError={item.isError}
      />
    );
  }

  // Write → file write view
  if (name === "write") {
    return (
      <ContentEdit
        filePath={str(parsed?.file_path)}
        mode="write"
        content={str(parsed?.content)}
        output={item.outputText || undefined}
        isError={item.isError}
      />
    );
  }

  // Fallback: generic input/output
  return (
    <div className="space-y-2">
      {item.inputText && <ContentText text={item.inputText} label="Input" compact />}
      {item.outputText && <ContentText text={item.outputText} label="Output" compact isError={item.isError} />}
    </div>
  );
}

/* ── Main ToolBlock ─────────────────────────────────────────────── */

export function ToolBlock({ item }: ToolBlockProps) {
  const [open, setOpen] = useState(false);
  const { icon, category } = getToolInfo(item.toolName);
  const headerTitle = getToolHeaderTitle(item.toolName, item.inputText, item.outputText);
  const isUserInput = item.toolName.toLowerCase() === "request_user_input";
  const inputSummary = !isUserInput && item.inputText ? summarizeInput(item.toolName, item.inputText) : "";
  const outputSummary =
    !isUserInput && item.status === "done" && item.outputText ? summarizeOutput(item.toolName, item.outputText) : "";
  const durationLabel = item.status === "done" ? formatToolDurationMs(item.durationMs) : null;

  const isStreaming = item.status === "streaming";
  const isAction = category === "action";

  const statusEl = isStreaming ? (
    <span className="flex shrink-0 items-center gap-1 text-xs text-accent">
      <StatusDot color="accent" pulse />
      <span>running</span>
    </span>
  ) : item.isError ? (
    <span className="shrink-0 text-xs text-danger">error</span>
  ) : null;

  const chevronEl = !isStreaming ? (
    <span
      className={cn(
        "shrink-0 text-xs leading-none text-muted transition-transform duration-150",
        open ? "rotate-180" : "rotate-0",
      )}
    >
      ▾
    </span>
  ) : null;

  const iconColorClass = isAction
    ? isStreaming
      ? "text-accent"
      : item.isError
        ? "text-danger"
        : "text-text/60"
    : "text-muted";

  return (
    <div className="pb-4">
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => !isStreaming && setOpen((v) => !v)}
          disabled={isStreaming}
          className="flex max-w-full flex-col gap-0.5 rounded-md py-0.5 pr-2 text-left"
        >
          {/* Header row: icon + name + chevron + status */}
          <div className="flex items-center gap-2 leading-none">
            <span
              className={cn(
                "inline-flex h-4 w-4 shrink-0 items-center justify-center font-mono text-sm leading-none",
                iconColorClass,
              )}
            >
              {icon}
            </span>
            <span className="text-sm font-medium leading-none text-muted">{headerTitle}</span>
            {durationLabel ? <span className="text-xs leading-none text-text/35">{durationLabel}</span> : null}
            {chevronEl}
            {statusEl}
          </div>
          {/* Summary rows */}
          {inputSummary || outputSummary ? (
            <div className="ml-6 flex flex-col gap-0.5">
              {inputSummary ? (
                <span className="max-w-[64ch] truncate font-mono text-xs text-text/50">{inputSummary}</span>
              ) : null}
              {outputSummary ? (
                <span className="max-w-[64ch] truncate font-mono text-xs text-accent/70">↳ {outputSummary}</span>
              ) : null}
            </div>
          ) : null}
        </button>

        {open && (
          <div className="pt-2 pb-3">
            <ToolContent item={item} />
          </div>
        )}
      </div>
    </div>
  );
}
