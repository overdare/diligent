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
import { StatusDot } from "./StatusDot";
import { ToolRenderBlocks } from "./ToolRenderBlocks";

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

type PatchFileChange = {
  action: "Add" | "Update" | "Delete";
  filePath: string;
  movedTo?: string;
  hunks: string[];
  added: number;
  removed: number;
  preview: string[];
};

function parsePatchChanges(patch: string): PatchFileChange[] {
  const lines = patch.split("\n");
  const changes: PatchFileChange[] = [];
  let current: PatchFileChange | null = null;
  let inHunk = false;

  const pushCurrent = () => {
    if (current) changes.push(current);
    current = null;
    inHunk = false;
  };

  for (const line of lines) {
    const fileMatch = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (fileMatch) {
      pushCurrent();
      current = {
        action: fileMatch[1] as PatchFileChange["action"],
        filePath: fileMatch[2].trim(),
        hunks: [],
        added: 0,
        removed: 0,
        preview: [],
      };
      continue;
    }

    if (!current) continue;

    const moveMatch = line.match(/^\*\*\* Move to: (.+)$/);
    if (moveMatch) {
      current.movedTo = moveMatch[1].trim();
      continue;
    }

    if (line.startsWith("@@")) {
      inHunk = true;
      current.hunks.push(line);
      continue;
    }

    if (!inHunk) continue;

    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.added += 1;
      if (current.preview.length < 12) current.preview.push(line);
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      current.removed += 1;
      if (current.preview.length < 12) current.preview.push(line);
    }
  }

  pushCurrent();
  return changes;
}

function ContentPatch({ patch, output, isError }: { patch?: string; output?: string; isError: boolean }) {
  if (!patch) {
    return output ? <ContentText text={output} label="Output" compact isError={isError} /> : null;
  }

  const changes = parsePatchChanges(patch);
  if (changes.length === 0) {
    return <ContentText text={patch} label="Patch" compact isError={isError} />;
  }

  return (
    <div className="space-y-2">
      {changes.map((change, idx) => {
        const pathLabel = change.movedTo ? `${change.filePath} → ${change.movedTo}` : change.filePath;
        return (
          <div
            key={`${change.action}:${pathLabel}:${idx}`}
            className="overflow-hidden rounded-lg border border-text/10 bg-bg/40"
          >
            <div className="flex items-center gap-2 border-b border-text/10 bg-surface/60 px-3 py-2 font-mono text-xs">
              <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-2xs text-accent/80">
                {change.action}
              </span>
              <span className="min-w-0 flex-1 truncate text-text/80">{pathLabel}</span>
              <span className="shrink-0 text-2xs text-emerald-400/80">+{change.added}</span>
              <span className="shrink-0 text-2xs text-danger/80">-{change.removed}</span>
            </div>
            {change.hunks.length > 0 ? (
              <div className="border-b border-text/10 px-3 py-1.5 font-mono text-2xs text-muted">
                {change.hunks.slice(0, 2).join(" · ")}
                {change.hunks.length > 2 ? ` · +${change.hunks.length - 2} more hunks` : ""}
              </div>
            ) : null}
            {change.preview.length > 0 ? (
              <pre className="overflow-x-auto whitespace-pre-wrap px-3 py-2 font-mono text-xs leading-relaxed text-text/80">
                {change.preview.join("\n")}
              </pre>
            ) : null}
          </div>
        );
      })}
      {output ? <ContentText text={output} label="Output" compact isError={isError} /> : null}
    </div>
  );
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

  if (name === "apply_patch") {
    return <ContentPatch patch={str(parsed?.patch)} output={item.outputText || undefined} isError={item.isError} />;
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
