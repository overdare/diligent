// @summary Grep-tool panel: pattern header with match results grouped by file

import { useState } from "react";
import { ExpandButton } from "./ExpandButton";

interface ContentGrepProps {
  pattern?: string;
  include?: string;
  path?: string;
  output?: string;
  isError?: boolean;
}

const PREVIEW_LINES = 20;

export function ContentGrep({ pattern, include, path, output, isError = false }: ContentGrepProps) {
  const [expanded, setExpanded] = useState(false);
  const lines = output?.split("\n").filter((l) => l.length > 0) ?? [];
  const isLong = lines.length > PREVIEW_LINES;
  const visibleLines = !expanded && isLong ? lines.slice(0, PREVIEW_LINES) : lines;

  const metaParts: string[] = [];
  if (include) metaParts.push(include);
  if (path) {
    const segments = path.split("/");
    metaParts.push(segments.slice(-2).join("/"));
  }

  return (
    <div className="overflow-hidden rounded-lg border border-text/10 bg-bg/60 font-mono text-xs">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-text/10 bg-surface/60 px-3 py-2">
        <span className="shrink-0 text-accent/70">⌕</span>
        {pattern ? <span className="rounded bg-accent/10 px-1.5 py-0.5 text-accent/90">/{pattern}/</span> : null}
        {metaParts.length > 0 ? <span className="min-w-0 truncate text-muted/70">{metaParts.join(" in ")}</span> : null}
        <span className="ml-auto shrink-0 text-muted/60">
          {lines.length} {lines.length === 1 ? "match" : "matches"}
        </span>
      </div>

      {/* Match results */}
      {lines.length > 0 ? (
        <div>
          <div className="space-y-0 px-3 py-2">
            {visibleLines.map((line, idx) => (
              <MatchLine key={idx} line={line} pattern={pattern} isError={isError} />
            ))}
          </div>
          {isLong ? (
            <ExpandButton
              expanded={expanded}
              onToggle={() => setExpanded((v) => !v)}
              detail={`${lines.length} matches`}
            />
          ) : null}
        </div>
      ) : output ? (
        <div className={`px-3 py-2 ${isError ? "text-danger/80" : "text-muted/60"}`}>
          {isError ? output.split("\n")[0] : "No matches found"}
        </div>
      ) : null}
    </div>
  );
}

function MatchLine({ line, pattern, isError }: { line: string; pattern?: string; isError: boolean }) {
  // Format: "/path/file.ts:42:  matched content"
  const match = line.match(/^(.+?):(\d+):(.*)$/);
  if (!match) {
    return <div className={`truncate leading-relaxed ${isError ? "text-danger/80" : "text-text/60"}`}>{line}</div>;
  }

  const [, filePath, lineNum, content] = match;
  const segments = (filePath ?? "").split("/");
  const shortPath = segments.slice(-2).join("/");

  return (
    <div className="flex items-baseline gap-2 leading-relaxed">
      <span className="shrink-0 text-muted/50">{shortPath}</span>
      <span className="shrink-0 text-accent/50">{lineNum}</span>
      <span className="min-w-0 truncate text-text/80">
        {pattern ? <HighlightedText text={content ?? ""} pattern={pattern} /> : content}
      </span>
    </div>
  );
}

function HighlightedText({ text, pattern }: { text: string; pattern: string }) {
  try {
    const regex = new RegExp(`(${escapeRegex(pattern)})`, "gi");
    const parts = text.split(regex);
    return (
      <>
        {parts.map((part, i) =>
          regex.test(part) ? (
            <span key={i} className="rounded bg-accent/20 text-accent">
              {part}
            </span>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </>
    );
  } catch {
    return <>{text}</>;
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
