// @summary Rolls the Studio map back to a snapshot (the last pre-request baseline by default).

import type { TextGenerationFn } from "@diligent/runtime";
import { z } from "zod";
import type { call } from "../rpc";
import type { Tool, ToolContext, ToolResult } from "../types";
import type { WriteLock } from "../write-lock";
import {
  captureSnapshot,
  findLatestSnapshot,
  findSnapshotById,
  nextRequestIndex,
  restoreSnapshot,
  type SnapshotEntry,
  snapshotsDir,
  truncateLabel,
} from "./snapshot";
import { saveLevelForSnapshot } from "./snapshot-capture";
import { summarizeSnapshot } from "./snapshot-summary";
import { checkResult } from "./v2/result";

interface RollbackOptions {
  writeLock?: WriteLock;
  generateText?: TextGenerationFn;
  getContext?: (context: ToolContext) => { sessionId?: string; userMessageId?: string; transcriptPath?: string };
}

const params = z.object({
  snapshotId: z
    .string()
    .optional()
    .describe(
      "Snapshot to restore, from studiorpc_snapshot_list. Omit to restore the state right before " +
        "the agent's most recent editing request.",
    ),
});

const description =
  "Roll the Studio map back to a saved snapshot. Without snapshotId, restores the state right before the " +
  "agent's most recent editing request. Deterministic full restore: the entire map is reverted to the " +
  "snapshot, discarding any changes made since (including the user's own edits). The discarded state is " +
  "first saved as a 'pre-rollback' snapshot, so the rollback itself can be undone by restoring that " +
  "snapshot via studiorpc_snapshot_list + snapshotId. If the user's reference to a restore point is " +
  "ambiguous, call studiorpc_snapshot_list and confirm the target with the user before calling this tool.";

function errorResult(message: string): ToolResult {
  return { output: message, metadata: { error: true, method: "rollback" } };
}

/**
 * Restore flow (PRD 4.2, extended): resolve target -> approve (naming the
 * target) -> save (flush editor) -> capture pre-rollback safety snapshot ->
 * overwrite ovdrjm with the target snapshot -> apply (sync editor; on failure,
 * put the safety copy back so disk and editor agree) -> save (persist).
 */
export function createRollbackTool(cwd: string, callRpc: typeof call, options: RollbackOptions = {}): Tool {
  return {
    name: "studiorpc_rollback",
    description,
    parameters: params,
    async execute(rawArgs, ctx: ToolContext): Promise<ToolResult> {
      const { snapshotId } = params.parse(rawArgs ?? {});

      // Resolve the target before asking for approval so the prompt can say
      // what will be restored — a bare snapshot id means nothing to the user.
      let target: SnapshotEntry;
      try {
        target = snapshotId ? findSnapshotById(cwd, snapshotId) : findLatestSnapshot(cwd);
      } catch (error) {
        return errorResult((error as Error).message);
      }
      const shortLabel = target.label === undefined ? undefined : truncateLabel(target.label);

      const approval = await ctx.approve({
        permission: "execute",
        toolName: "studiorpc_rollback",
        description: `Roll back the Studio map to snapshot ${target.id}${shortLabel ? ` ("${shortLabel}")` : ""}`,
        details: snapshotId ? { snapshotId } : {},
      });
      if (approval === "reject") {
        return errorResult("[Rejected by user]");
      }

      const context = options.getContext?.(ctx);
      const release = await options.writeLock?.acquire();
      try {
        // Flush the current editor state so the level files are consistent.
        // After this, the on-disk ovdrjm IS the pre-rollback state.
        try {
          await saveLevelForSnapshot(callRpc, ctx.signal);
        } catch (error) {
          return errorResult(`Rollback was not started: ${(error as Error).message}`);
        }

        // Preserve the state being discarded so this rollback can be undone.
        // Best-effort: without it the rollback still works, just without undo.
        let safetyPath: string | undefined;
        try {
          const sessionId = context?.sessionId ?? target.sessionId;
          const index = nextRequestIndex(snapshotsDir(cwd), sessionId);
          safetyPath = captureSnapshot(cwd, sessionId, index, {
            label: "state before rollback",
            kind: "pre-rollback",
            userMessageId: context?.userMessageId,
            transcriptPath: context?.transcriptPath,
            summaryStatus: options.generateText ? "pending" : "unavailable",
          });
          if (options.generateText)
            void summarizeSnapshot(findSnapshotById(cwd, `${sessionId}_${index}`), options.generateText);
        } catch {
          // not fatal — proceed without undo support
        }

        restoreSnapshot(cwd, target.path);
        try {
          checkResult("level.apply", await callRpc("level.apply", {}, { signal: ctx.signal }));
        } catch (error) {
          // The editor was not synced; make disk and editor agree again so the
          // turn-end save cannot silently clobber a half-applied rollback.
          let recovered = false;
          if (safetyPath) {
            restoreSnapshot(cwd, safetyPath);
            recovered = true;
          } else {
            // No safety copy — ask the editor to re-save its (pre-rollback)
            // state over the half-restored file.
            try {
              await saveLevelForSnapshot(callRpc);
              recovered = true;
            } catch {
              // editor unreachable; report the inconsistency honestly below
            }
          }
          return errorResult(
            recovered
              ? `Rollback failed: level.apply error (${(error as Error).message}). The map was left unchanged; ` +
                  `fix the Studio connection and retry.`
              : `Rollback failed: level.apply error (${(error as Error).message}). The on-disk level file now ` +
                  `holds the target snapshot but the editor was not synced and could not re-save; verify the map ` +
                  `state in Studio before continuing.`,
          );
        }
        try {
          await saveLevelForSnapshot(callRpc, ctx.signal);
        } catch (error) {
          return errorResult(
            `Snapshot ${target.id} was applied, but the final save failed: ${(error as Error).message}. Verify the map in Studio.`,
          );
        }

        const labelNote = shortLabel ? ` ("${shortLabel}")` : "";
        const undoNote = safetyPath
          ? " To undo this rollback, restore the pre-rollback snapshot listed by studiorpc_snapshot_list."
          : " Note: the discarded state could not be saved; this rollback cannot be undone.";
        return {
          output:
            `Rolled back to snapshot ${target.id}${labelNote}, captured at ${target.createdAt}. ` +
            `Instances and scripts created after that point no longer exist — re-read the map before ` +
            `referencing them.${undoNote}`,
          metadata: { method: "rollback", restored: target.id },
        };
      } finally {
        release?.();
      }
    },
  };
}
