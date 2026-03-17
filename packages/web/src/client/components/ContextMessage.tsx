// @summary Collapsible system checkpoint block for compaction summaries in the visible transcript

import { useState } from "react";
import { MarkdownContent } from "./MarkdownContent";
import { SystemCard } from "./SystemCard";

interface ContextMessageProps {
  summary: string;
}

export function ContextMessage({ summary }: ContextMessageProps) {
  const [open, setOpen] = useState(false);

  const previewLine = summary
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"))
    ?.slice(0, 140);

  return (
    <SystemCard>
      <div className="space-y-3">
        <button
          type="button"
          className="flex w-full items-start gap-3 text-left"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-info/25 bg-info/10 text-[13px] text-info/90">
            ⟳
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-info/80">
              <span>Context checkpoint</span>
              <span className="rounded-full border border-info/20 bg-info/10 px-2 py-0.5 text-[10px] tracking-normal text-text-soft/80">
                Compacted
              </span>
            </div>
            <div className="mt-1 text-sm text-text/90">
              Older conversation was compressed to keep the thread efficient.
            </div>
            {previewLine ? (
              <div className="mt-1 text-xs text-muted">
                {previewLine}
                {summary.length > previewLine.length ? "…" : ""}
              </div>
            ) : null}
          </div>
          <div className={`pt-0.5 text-xs text-muted transition-transform ${open ? "rotate-90" : ""}`}>▶</div>
        </button>

        {open ? (
          <div className="rounded-md border border-border/40 bg-overlay/10 px-4 py-3">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">Summary details</div>
            <MarkdownContent text={summary} />
          </div>
        ) : null}
      </div>
    </SystemCard>
  );
}
