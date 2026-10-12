// @summary Prominent notice that recorded Studio changes were handed to the agent

import { useState } from "react";
import { ChevronDown, Pencil } from "./icons";
import { MarkdownContent } from "./MarkdownContent";
import { detailPanelClasses, focusRingClasses } from "./ui-styles";

interface StudioChangesNoticeProps {
  summary: string;
}

/** Kept in step with SECTION_TITLES in tools/studiorpc/tools/edit-log.ts by a test. */
export const COUNT_SECTIONS = [
  "Added",
  "Added then removed",
  "Removed",
  "Moved",
  "Modified",
  "Script source changed",
] as const;

/** Total change count parsed from the diff section headers, e.g. "3 changes". */
function countLabel(summary: string): string {
  const completeCount = summary.match(/^Total changes: (\d+)$/m);
  let total = completeCount ? Number(completeCount[1]) : 0;
  if (!completeCount) {
    for (const section of COUNT_SECTIONS) {
      for (const match of summary.matchAll(new RegExp(`^${section} \\((\\d+)\\):`, "gm"))) total += Number(match[1]);
    }
  }
  if (total === 0) return "";
  return total === 1 ? "1 change" : `${total} changes`;
}

export function StudioChangesNotice({ summary }: StudioChangesNoticeProps) {
  const [open, setOpen] = useState(false);
  const counts = countLabel(summary);

  return (
    <div className="py-2">
      <div className="rounded-md border border-border/40 bg-surface-default px-3 py-2">
        <button
          type="button"
          className={`group flex w-full items-center gap-2 rounded-md text-left ${focusRingClasses}`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Pencil aria-hidden="true" className="h-4 w-4 shrink-0 text-muted/80" strokeWidth={1.8} />
          <span className="text-xs font-medium leading-5 text-text">Studio changes detected</span>
          {counts ? <span className="text-xs leading-5 text-muted">{counts}</span> : null}
          <ChevronDown
            aria-hidden="true"
            className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-150 group-hover:text-text ${open ? "rotate-180" : "rotate-0"}`}
            strokeWidth="2"
          />
        </button>
        <p className="mt-1 text-xs leading-5 text-muted">
          The agent will compare these changes with its own work. They may include changes made by this session.
        </p>
        {open ? (
          <div className="mt-2">
            <div className={detailPanelClasses}>
              <MarkdownContent text={summary} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
