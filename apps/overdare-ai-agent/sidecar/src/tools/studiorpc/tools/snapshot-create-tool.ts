// @summary Creates a labeled manual whole-level checkpoint without changing the map.
import { z } from "zod";
import type { Tool, ToolContext } from "../types";
import type { SnapshotEntry } from "./snapshot";

const parameters = z.object({});

export function createSnapshotCreateTool(
  capture: (signal: AbortSignal, context: ToolContext) => Promise<SnapshotEntry>,
): Tool {
  return {
    name: "studiorpc_snapshot_create",
    description:
      "Save the current Studio level and create a labeled manual checkpoint of the entire .ovdrjm. " +
      "Use at a useful development milestone or when the user asks to keep the current state. " +
      "The checkpoint label and state summary are generated internally when a model is available. " +
      "Manual checkpoints survive automatic snapshot cleanup. Returns a snapshotId for snapshot_context or rollback. " +
      "This is a level checkpoint, not a backup of .umap files or external assets.",
    parameters,
    async execute(args, ctx: ToolContext) {
      parameters.parse(args ?? {});
      const approval = await ctx.approve({
        permission: "execute",
        toolName: "studiorpc_snapshot_create",
        description: "Save the Studio level and create a manual checkpoint",
        details: {},
      });
      if (approval === "reject") return { output: "[Rejected by user]", metadata: { error: true } };
      try {
        const { path: _path, ...snapshot } = await capture(ctx.signal, ctx);
        return {
          output: `Created manual checkpoint ${snapshot.id}.\n${JSON.stringify(snapshot, null, 2)}`,
          metadata: { method: "snapshot.create", snapshotId: snapshot.id },
        };
      } catch (error) {
        return {
          output: `Checkpoint failed: ${error instanceof Error ? error.message : String(error)}`,
          metadata: { error: true, method: "snapshot.create" },
        };
      }
    },
  };
}
