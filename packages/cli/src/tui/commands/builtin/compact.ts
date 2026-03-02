// @summary Compact command - compresses message history to reduce token usage
import { t } from "../../theme";
import type { Command } from "../types";

export const compactCommand: Command = {
  name: "compact",
  description: "Trigger manual compaction",
  handler: async (_args, ctx) => {
    ctx.displayLines([`  ${t.dim}Compaction is triggered automatically. Use /status to see token usage.${t.reset}`]);
  },
};
