// @summary Thinking effort command with provider-aware minimal support

import type { ThinkingEffort } from "@diligent/protocol";
import {
  getThinkingEffortLabel,
  getThinkingEffortOptions,
  getThinkingEffortUsage,
  resolveModel,
  supportsThinkingNone,
} from "@diligent/runtime";
import { ListPicker, type ListPickerItem } from "../../components/list-picker";
import { t } from "../../theme";
import type { Command } from "../types";

const EFFORT_ALIASES: Record<string, ThinkingEffort> = {
  none: "none",
  minimal: "none",
  low: "low",
  medium: "medium",
  high: "high",
  max: "max",
};

export const effortCommand: Command = {
  name: "effort",
  description: "Set thinking level",
  supportsArgs: true,
  handler: async (args, ctx) => {
    const model = resolveModel(ctx.config.model.id);
    const options = getThinkingEffortOptions(model);

    if (args) {
      const normalized = EFFORT_ALIASES[args.trim().toLowerCase()];
      if (!normalized) {
        ctx.displayError(`Unknown effort: ${args}. Usage: /effort <${getThinkingEffortUsage(model)}>`);
        return;
      }
      if (normalized === "none" && model.supportsThinking && !supportsThinkingNone(model)) {
        ctx.displayError("This model does not support minimal thinking.");
        return;
      }
      await ctx.setEffort(normalized);
      ctx.onEffortChanged(normalized, getThinkingEffortLabel(normalized, model));
      ctx.displayLines([`  Thinking set to ${t.bold}${getThinkingEffortLabel(normalized, model)}${t.reset}`]);
      return;
    }

    const items: ListPickerItem[] = options.map((option) => ({
      label: option.label,
      description: option.value,
      value: option.value,
    }));
    const selectedIdx = items.findIndex((item) => item.value === ctx.currentEffort);

    await new Promise<void>((resolve) => {
      const picker = new ListPicker(
        { title: "Thinking", items, selectedIndex: Math.max(0, selectedIdx) },
        async (value) => {
          handle.hide();
          ctx.requestRender();
          if (value) {
            const effort = value as ThinkingEffort;
            await ctx.setEffort(effort);
            ctx.onEffortChanged(effort, getThinkingEffortLabel(effort, model));
            ctx.displayLines([`  Thinking set to ${t.bold}${getThinkingEffortLabel(effort, model)}${t.reset}`]);
          }
          resolve();
        },
      );
      const handle = ctx.showOverlay(picker, { anchor: "center" });
      ctx.requestRender();
    });
  },
};
