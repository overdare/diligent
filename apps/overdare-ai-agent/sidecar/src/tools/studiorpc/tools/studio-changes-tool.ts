// @summary Bounded per-consumer Studio summaries and temporary RAM detail pages
import { z } from "zod";
import type { Tool, ToolResult } from "../types";
import {
  MID_TURN_HEADER,
  NO_EDITS_MESSAGE,
  SECTION_TITLES,
  STUDIO_CHANGES_LIMITS,
  type StudioChangeType,
  studioChangeDetails,
  summarizeEditLog,
} from "./edit-log";
import type { StudioChangeCollector } from "./studio-change-collector";
import type { StudioChangeConsumer, StudioChangeRead } from "./studio-change-store";

const params = z.object({
  view: z.enum(["new", "details"]).default("new").describe("New changes or paginated temporary RAM details."),
  batchId: z
    .string()
    .max(100)
    .optional()
    .describe("Batch ID from a summary; details default to your latest retained batch."),
  guid: z.string().max(1000).optional().describe("Limit details to one instance GUID."),
  changeType: z.enum(Object.keys(SECTION_TITLES) as [StudioChangeType, ...StudioChangeType[]]).optional(),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(20).default(20),
});

export interface StudioChangesCapture {
  result: ToolResult;
  id?: string;
  delivered: boolean;
  /** Acknowledge this consumer only; collection owns source cleanup. */
  finalize(): void;
}

export function captureStudioChanges(read: StudioChangeRead, header?: string): StudioChangesCapture {
  const rawWarnings = read.gaps.slice(0, 3).join(" ");
  let warningDetails = "";
  let warningBytes = 0;
  for (const character of rawWarnings) {
    const bytes = Buffer.byteLength(character);
    if (warningBytes + bytes > 1200) break;
    warningDetails += character;
    warningBytes += bytes;
  }
  const warnings = read.gaps.length
    ? `History warning: ${warningDetails} ${read.gaps.length > 3 || warningDetails !== rawWarnings ? "Additional collection gaps omitted. " : ""}History may be incomplete; inspect current Studio state.`
    : "";
  const details = read.batchId
    ? `Batch ID: ${read.batchId}. Details retained temporarily in RAM; use studiorpc_studio_changes with view="details", batchId="${read.batchId}", optional guid/changeType and offset/limit.`
    : "";
  const summary = summarizeEditLog(read.envelopes, 0, header, {
    footer: [warnings, details].filter(Boolean).join("\n") || undefined,
  });
  const capture: StudioChangesCapture = {
    id: read.batchId,
    delivered: false,
    result: {
      output: summary.editCount ? summary.output : warnings || NO_EDITS_MESSAGE,
      metadata: {
        method: "studio_changes",
        studioChangesDetected: summary.editCount > 0,
        historyGap: read.gaps.length > 0,
        transactions: read.envelopes.length,
        batchId: read.batchId,
        shownTargets: summary.shownTargets,
        omittedTargets: summary.omittedTargets,
      },
    },
    finalize() {
      read.acknowledge();
      capture.delivered = true;
    },
  };
  return capture;
}

export function createStudioChangesTool(
  collector: StudioChangeCollector,
  getConsumer: () => StudioChangeConsumer,
): Tool {
  return {
    name: "studiorpc_studio_changes",
    description:
      "Report collected Studio changes not yet returned to this session. " +
      "Explicit MCP edits from this session's main/child group are excluded; other sessions remain visible. " +
      "A legacy log does not identify who made them and may include this session's own work. " +
      "Summaries are bounded; use view=details with the batchId and offset/limit for omitted properties. " +
      "Details are temporary RAM history, not disk archives. Expired history requires inspecting current Studio state. " +
      "The shared host collector owns source files; a query advances only this session's marker.",
    parameters: params,
    async execute(raw) {
      try {
        const input = params.parse(raw);
        const consumer = getConsumer();
        if (input.view === "details" || input.batchId || input.guid || input.changeType || input.offset) {
          const id = input.batchId ?? collector.store.latestBatch(consumer);
          if (!id)
            return {
              output: "No retained Studio change batch for this session. Query new changes first.",
              metadata: { method: "studio_changes" },
            };
          const envelopes = collector.store.readBatch(id, consumer);
          const heading = `Studio change details (batch ${id}):`;
          const page = studioChangeDetails(envelopes, {
            ...input,
            maxBytes: STUDIO_CHANGES_LIMITS.targetBytes - Buffer.byteLength(heading) - 200,
          });
          const continuation =
            page.nextOffset === undefined ? "End of matching details." : `Continue with offset=${page.nextOffset}.`;
          return {
            output: `${heading}\n${page.output || "No matching changes."}\n\n${continuation}\nDetails retained temporarily in RAM.`,
            metadata: { method: "studio_changes", batchId: id, total: page.total, nextOffset: page.nextOffset },
          };
        }
        await collector.refresh();
        const capture = captureStudioChanges(collector.store.read(consumer), MID_TURN_HEADER);
        capture.finalize();
        return capture.result;
      } catch (error) {
        return {
          output: `Error: ${error instanceof Error ? error.message : String(error)}`,
          metadata: { error: true, method: "studio_changes" },
        };
      }
    },
  };
}
