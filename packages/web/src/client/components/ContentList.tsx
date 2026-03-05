// @summary Glob/Ls-tool panel: pattern/path header with compact file listing

import { useState } from "react";
import { ExpandButton } from "./ExpandButton";

interface ContentListProps {
  /** "glob" or "ls" */
  mode: "glob" | "ls";
  pattern?: string;
  path?: string;
  output?: string;
  isError?: boolean;
}

const PREVIEW_ITEMS = 20;

export function ContentList({ mode, pattern, path, output, isError = false }: ContentListProps) {
  const [expanded, setExpanded] = useState(false);
  const items = output?.split("\n").filter((l) => l.trim().length > 0) ?? [];
  const isLong = items.length > PREVIEW_ITEMS;
  const visibleItems = !expanded && isLong ? items.slice(0, PREVIEW_ITEMS) : items;

  const shortPath = path ? path.split("/").slice(-2).join("/") : "";

  return (
    <div className="overflow-hidden rounded-lg border border-text/10 bg-bg/60 font-mono text-xs">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-text/10 bg-surface/60 px-3 py-2">
        <span className="shrink-0 text-accent/70">{mode === "glob" ? "⌕" : "≡"}</span>
        {pattern ? <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent/90">{pattern}</span> : null}
        {shortPath ? <span className="min-w-0 truncate text-muted/70">{shortPath}</span> : null}
        <span className="ml-auto shrink-0 text-muted/60">
          {items.length} {items.length === 1 ? "item" : "items"}
        </span>
      </div>

      {/* File list */}
      {items.length > 0 ? (
        <div>
          <div className="space-y-0 px-3 py-2">
            {visibleItems.map((item) => (
              <FileEntry key={item} entry={item} mode={mode} />
            ))}
          </div>
          {isLong ? (
            <ExpandButton
              expanded={expanded}
              onToggle={() => setExpanded((v) => !v)}
              detail={`${items.length} items`}
            />
          ) : null}
        </div>
      ) : output ? (
        <div className={`px-3 py-2 ${isError ? "text-danger/80" : "text-muted/60"}`}>
          {isError ? output.split("\n")[0] : "Empty"}
        </div>
      ) : null}
    </div>
  );
}

function FileEntry({ entry, mode }: { entry: string; mode: "glob" | "ls" }) {
  const trimmed = entry.trim();
  const isDir = trimmed.endsWith("/");

  if (mode === "ls") {
    // ls output may have type indicators
    return (
      <div className="flex items-baseline gap-2 leading-relaxed">
        <span className={`shrink-0 ${isDir ? "text-accent/60" : "text-muted/40"}`}>{isDir ? "▸" : "·"}</span>
        <span className={`min-w-0 truncate ${isDir ? "text-accent/80" : "text-text/70"}`}>{trimmed}</span>
      </div>
    );
  }

  // glob: show shortened path
  const segments = trimmed.split("/");
  const shortName = segments.length > 2 ? `…/${segments.slice(-2).join("/")}` : trimmed;

  return (
    <div className="flex items-baseline gap-2 leading-relaxed">
      <span className="shrink-0 text-muted/40">·</span>
      <span className="min-w-0 truncate text-text/70">{shortName}</span>
    </div>
  );
}
