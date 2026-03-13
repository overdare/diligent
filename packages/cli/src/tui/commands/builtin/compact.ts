// @summary Compact command - compresses message history to reduce token usage
import { DILIGENT_CLIENT_REQUEST_METHODS } from "@diligent/protocol";
import { t } from "../../theme";
import type { Command } from "../types";

export const compactCommand: Command = {
  name: "compact",
  description: "Trigger manual compaction",
  handler: async (_args, ctx) => {
    if (!ctx.threadId) {
      ctx.displayError("No active thread to compact.");
      return;
    }
    const client = ctx.app.getRpcClient?.();
    if (!client) {
      ctx.displayError("No RPC client available.");
      return;
    }
    ctx.displayLines([`  ${t.dim}Compacting…${t.reset}`]);
    try {
      const result = await client.request(DILIGENT_CLIENT_REQUEST_METHODS.THREAD_COMPACT_START, {
        threadId: ctx.threadId,
      });
      if (result.compacted) {
        ctx.displayLines([
          `  ${t.success}Compacted:${t.reset} ${t.dim}${result.entryCount} entries, ${Math.round(result.tokensBefore / 1000)}k → ${Math.round(result.tokensAfter / 1000)}k tokens${t.reset}`,
        ]);
      } else {
        ctx.displayLines([`  ${t.dim}Nothing to compact.${t.reset}`]);
      }
    } catch (err) {
      ctx.displayError(`Compaction failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};
