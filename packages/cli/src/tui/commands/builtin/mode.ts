// @summary Direct collaboration-mode commands: /default, /plan, /exec

import { MODE_COMMAND_NAMES, type Mode, ModeSchema } from "@diligent/protocol";
import { t } from "../../theme";
import type { Command } from "../types";

function createModeCommand(mode: Mode): Command {
  return {
    name: MODE_COMMAND_NAMES[mode],
    description: `Switch to ${mode} mode`,
    handler: async (_args, ctx) => {
      ctx.setMode(mode);
      ctx.displayLines([`  Mode: ${t.bold}${mode}${t.reset}`]);
    },
  };
}

/** One command per mode, derived so a new mode gets its command for free. */
export const modeCommands: Command[] = ModeSchema.options.map(createModeCommand);
