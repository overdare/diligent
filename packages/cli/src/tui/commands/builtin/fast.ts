// @summary Toggle GPT Fast mode independently of model and reasoning effort
import type { Command } from "../types";

export const fastCommand: Command = {
  name: "fast",
  description: "Toggle GPT Fast mode (higher cost / usage)",
  supportsArgs: true,
  handler: async (args, ctx) => {
    const value = args?.trim().toLowerCase() ?? "";
    if (value && value !== "on" && value !== "off") {
      ctx.displayError("Usage: /fast [on|off]");
      return;
    }
    const fastMode = value ? value === "on" : !ctx.currentFastMode;
    if (fastMode && !ctx.config.model.supportsFastMode) {
      ctx.displayError("Fast mode is not supported for this model.");
      return;
    }
    await ctx.setFastMode(fastMode);
    ctx.displayLines([`  Fast mode ${fastMode ? "on — higher cost / usage" : "off"}. Applies to the next turn.`]);
  },
};
