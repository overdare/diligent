// @summary Collapsible system-like block for compaction summary context

import { useState } from "react";
import { MarkdownContent } from "./MarkdownContent";

interface ContextMessageProps {
  summary: string;
}

export function ContextMessage({ summary }: ContextMessageProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="my-2 rounded-lg border border-border/50 bg-surface/50">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-muted hover:text-text"
        onClick={() => setOpen(!open)}
      >
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>&#9654;</span>
        <span>Previous context (compacted)</span>
      </button>
      {open && (
        <div className="border-t border-border/30 px-4 py-3">
          <MarkdownContent text={summary} />
        </div>
      )}
    </div>
  );
}
