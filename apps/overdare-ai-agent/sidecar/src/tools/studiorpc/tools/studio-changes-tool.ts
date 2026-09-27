// @summary Reports bounded Studio change summaries and pages complete local batches without attributing authorship.

import { createHash } from "node:crypto";
import { z } from "zod";
import type { Tool, ToolResult } from "../types";
import {
  deleteConsumed,
  type EditLogEnvelope,
  MID_TURN_HEADER,
  NO_EDITS_MESSAGE,
  peekEditLogs,
  rotateAndReadEditLogs,
  SECTION_TITLES,
  STUDIO_CHANGES_LIMITS,
  type StudioChangeType,
  studioChangeDetails,
  summarizeEditLog,
} from "./edit-log";
import {
  latestStudioChangeBatch,
  readStudioChangeBatch,
  storeStudioChangeBatch,
  studioChangeArchivePath,
} from "./studio-change-store";

const params = z.object({
  view: z
    .enum(["new", "details"])
    .default("new")
    .describe("New changes not yet reported, or paginated archived details."),
  batchId: z.string().optional().describe("Batch ID from a summary. Details default to the latest captured batch."),
  guid: z.string().optional().describe("Limit archived details to one instance GUID."),
  changeType: z.enum(Object.keys(SECTION_TITLES) as [StudioChangeType, ...StudioChangeType[]]).optional(),
  offset: z.number().int().nonnegative().default(0).describe("Zero-based detail row offset."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(20)
    .describe("Maximum detail rows; the output byte budget may return fewer."),
});

const description =
  "Report new changes recorded in Studio's edit log without repeating the delivered turn-start summary or previous queries. " +
  'Automatic summaries are bounded; use view="details" with a batchId, optional guid/changeType, and offset/limit to inspect omitted changes. ' +
  "Details page individual changes, including properties omitted from summaries. " +
  "The log does not identify who made them and may include this session's own work. " +
  "Compare with your own work; inspect affected instances before editing if anything differs from expectations. " +
  "Does not edit Studio or consume its live log; stores complete batches locally.";

export interface StudioChangesCapture {
  result: ToolResult;
  id?: string;
  delivered: boolean;
  /** Mark the automatic summary delivered, then delete the durably archived rotated files. */
  finalize: () => void;
}

function footer(id: string): string {
  return `Batch ID: ${id}. Full details saved locally. Use studiorpc_studio_changes with view="details", batchId="${id}", optional guid/changeType and offset/limit.`;
}

export function consumeStudioChanges(cwd: string): StudioChangesCapture {
  try {
    const { envelopes, parseFailures, consumedPaths } = rotateAndReadEditLogs(cwd);
    const archive =
      envelopes.length || parseFailures ? storeStudioChangeBatch(cwd, envelopes, parseFailures) : undefined;
    const summary = summarizeEditLog(envelopes, parseFailures, undefined, {
      footer: archive ? footer(archive.id) : undefined,
    });
    const capture: StudioChangesCapture = {
      id: archive?.id,
      delivered: false,
      result: {
        output: summary.output,
        metadata: {
          method: "studio_changes",
          studioChangesDetected: summary.editCount > 0,
          transactions: envelopes.length,
          batchId: archive?.id,
          archivePath: archive?.path,
          shownTargets: summary.shownTargets,
          omittedTargets: summary.omittedTargets,
        },
      },
      finalize: () => {
        capture.delivered = true;
        deleteConsumed(consumedPaths);
      },
    };
    return capture;
  } catch (error) {
    return {
      delivered: false,
      result: errorResult(error),
      // Preserve rotated files when archival failed so the next turn can retry.
      finalize: () => {},
    };
  }
}

function errorResult(error: unknown): ToolResult {
  return {
    output: `Error: ${error instanceof Error ? error.message : String(error)}`,
    metadata: { error: true, method: "studio_changes" },
  };
}

export function createStudioChangesTool(cwd: string, getCached?: () => StudioChangesCapture | undefined): Tool {
  let lastCapture: StudioChangesCapture | undefined;
  let lastBatchId: string | undefined;
  let lastGeneration: string | undefined;
  let reported = new Map<string, number>();
  return {
    name: "studiorpc_studio_changes",
    description,
    parameters: params,
    async execute(raw) {
      try {
        const input = params.parse(raw);
        const cached = getCached?.();
        if (cached !== lastCapture) {
          reported.clear();
          lastBatchId = undefined;
          lastCapture = cached;
        }
        // Explicit filters select archived detail mode even when view is omitted.
        if (input.view === "details" || input.batchId || input.guid || input.changeType || input.offset) {
          let id = input.batchId ?? lastBatchId ?? cached?.id;
          if (!id) {
            const live = peekEditLogs(cwd);
            id = live.envelopes.length
              ? storeStudioChangeBatch(cwd, live.envelopes, live.parseFailures).id
              : latestStudioChangeBatch(cwd);
            lastBatchId = id;
          }
          if (!id) return { output: NO_EDITS_MESSAGE, metadata: { method: "studio_changes" } };
          const batch = readStudioChangeBatch(cwd, id);
          const path = studioChangeArchivePath(cwd, id);
          const fullValues = `Full values: ${Buffer.byteLength(path, "utf8") <= 1_000 ? path : "see archivePath in result metadata"}`;
          const heading = `Studio change details (batch ${id}):`;
          const page = studioChangeDetails(batch.envelopes, {
            ...input,
            maxBytes:
              STUDIO_CHANGES_LIMITS.targetBytes - Buffer.byteLength(`${heading}\n\n${fullValues}`, "utf8") - 100,
          });
          const continuation =
            page.nextOffset === undefined ? "End of matching details." : `Continue with offset=${page.nextOffset}.`;
          return {
            output: `${heading}\n${page.output || "No matching changes."}\n\n${continuation}\n${fullValues}`,
            metadata: {
              method: "studio_changes",
              batchId: id,
              total: page.total,
              nextOffset: page.nextOffset,
              archivePath: path,
            },
          };
        }
        const live = peekEditLogs(cwd);
        if (live.generation !== lastGeneration) reported.clear();
        const current = new Map<string, number>();
        const unseen: EditLogEnvelope[] = [];
        for (const envelope of live.envelopes) {
          const key = createHash("sha256").update(JSON.stringify(envelope)).digest("hex");
          const occurrence = (current.get(key) ?? 0) + 1;
          current.set(key, occurrence);
          if (occurrence > (reported.get(key) ?? 0)) unseen.push(envelope);
        }
        const cachedEnvelopes =
          cached && !cached.delivered && cached.id ? readStudioChangeBatch(cwd, cached.id).envelopes : [];
        unseen.unshift(...cachedEnvelopes);
        if (!unseen.length)
          return cached?.result.metadata?.error
            ? cached.result
            : { output: NO_EDITS_MESSAGE, metadata: { method: "studio_changes" } };
        // Store the full live batch so pagination is stable even after the log grows.
        const archive = storeStudioChangeBatch(cwd, [...cachedEnvelopes, ...live.envelopes], live.parseFailures);
        const summary = summarizeEditLog(unseen, live.parseFailures, MID_TURN_HEADER, { footer: footer(archive.id) });
        reported = current;
        lastGeneration = live.generation;
        lastBatchId = archive.id;
        if (cached && !cached.delivered) cached.finalize();
        return {
          output: summary.output,
          metadata: {
            method: "studio_changes",
            studioChangesDetected: summary.editCount > 0,
            batchId: archive.id,
            archivePath: archive.path,
            shownTargets: summary.shownTargets,
            omittedTargets: summary.omittedTargets,
          },
        };
      } catch (error) {
        return errorResult(error);
      }
    },
  };
}
