// @summary Reports recorded Studio changes without attributing them to a particular editor.

import { z } from "zod";
import type { Tool, ToolResult } from "../types";
import {
  deleteConsumed,
  MID_TURN_HEADER,
  NO_EDITS_MESSAGE,
  peekEditLogs,
  rotateAndReadEditLogs,
  summarizeEditLog,
} from "./edit-log";

const params = z.object({});

const description =
  "Summarize changes recorded in Studio's edit-transaction log (added/removed/moved instances, " +
  "property changes, script edits). Includes the batch collected at turn start and changes recorded " +
  "during this turn. The log does not identify who made them and may include this session's own work. " +
  "Compare these changes with your own work; inspect the affected instances before editing if " +
  "anything differs from what you expect. Read-only.";

/** Turn-start capture: the frozen summary plus a callback that deletes the consumed log files. */
export interface StudioChangesCapture {
  result: ToolResult;
  /** Delete the rotated log files. Call once the summary has been delivered into the turn. */
  finalize: () => void;
}

/**
 * Consume all pending edit-log transactions: rotate the files out of Studio's
 * way, summarize them, and hand back a deferred deletion. Called at turn start
 * to separate the collected batch from changes recorded during this turn.
 * The log does not establish which session or editor made a change.
 */
export function consumeStudioChanges(cwd: string): StudioChangesCapture {
  try {
    const { envelopes, parseFailures, consumedPaths } = rotateAndReadEditLogs(cwd);
    const { output, editCount } = summarizeEditLog(envelopes, parseFailures);
    return {
      result: {
        output,
        metadata: { method: "studio_changes", studioChangesDetected: editCount > 0, transactions: envelopes.length },
      },
      finalize: () => deleteConsumed(consumedPaths),
    };
  } catch (error) {
    return {
      result: {
        output: `Error: ${error instanceof Error ? error.message : String(error)}`,
        metadata: { error: true, method: "studio_changes" },
      },
      finalize: () => {},
    };
  }
}

/** Non-destructive summary of edits logged after turn start (edits made during this turn). */
function peekStudioChanges(cwd: string): ToolResult {
  try {
    const { envelopes, parseFailures } = peekEditLogs(cwd);
    const { output, editCount } = summarizeEditLog(envelopes, parseFailures, MID_TURN_HEADER);
    return { output, metadata: { method: "studio_changes", studioChangesDetected: editCount > 0 } };
  } catch (error) {
    return {
      output: `Error: ${error instanceof Error ? error.message : String(error)}`,
      metadata: { error: true, method: "studio_changes" },
    };
  }
}

export function createStudioChangesTool(cwd: string, getCached?: () => ToolResult | undefined): Tool {
  return {
    name: "studiorpc_studio_changes",
    description,
    parameters: params,
    async execute() {
      const cached = getCached?.();
      const live = peekStudioChanges(cwd);
      const parts: string[] = [];
      if (cached?.metadata?.studioChangesDetected === true) parts.push(cached.output);
      if (live.metadata?.studioChangesDetected === true) parts.push(live.output);
      if (parts.length === 0) return cached ?? { output: NO_EDITS_MESSAGE, metadata: { method: "studio_changes" } };
      return {
        output: parts.join("\n\n"),
        metadata: { method: "studio_changes", studioChangesDetected: true },
      };
    },
  };
}
