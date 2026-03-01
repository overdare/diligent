// @summary Model selection command - allows switching between available LLM models
import { KNOWN_MODELS, resolveModel } from "@diligent/core";
import { saveModel } from "../../../config-writer";
import { PROVIDER_NAMES, type ProviderName } from "../../../provider-manager";
import { ListPicker, type ListPickerItem } from "../../components/list-picker";
import { t } from "../../theme";
import type { Command } from "../types";
import { promptApiKey } from "./provider";

export const modelCommand: Command = {
  name: "model",
  description: "Switch model or show picker",
  supportsArgs: true,
  handler: async (args, ctx) => {
    if (args) {
      try {
        const model = resolveModel(args);
        const provider = (model.provider ?? "anthropic") as ProviderName;

        // Check if provider has API key
        if (!ctx.config.providerManager.hasKeyFor(provider)) {
          ctx.displayLines([`  ${t.warn}No API key for ${provider}. Please enter one:${t.reset}`]);
          await promptApiKey(provider, ctx);
          // After key input, check again
          if (!ctx.config.providerManager.hasKeyFor(provider)) {
            ctx.displayError("Model switch cancelled — no API key provided.");
            return;
          }
        }

        ctx.config.model = model;
        ctx.onModelChanged(model.id);
        ctx.displayLines([`  Model switched to ${t.bold}${model.id}${t.reset}`]);
        saveModel(model.id).catch(() => {});
      } catch {
        ctx.displayError(`Unknown model: ${args}`);
      }
      return;
    }

    // Show picker with known models, grouped by provider
    const currentModelId = ctx.config.model.id;
    const currentProvider = (ctx.config.model.provider ?? "anthropic") as ProviderName;
    const pm = ctx.config.providerManager;

    // Sort providers: current → configured → unconfigured
    const sortedProviders = [...PROVIDER_NAMES].sort((a, b) => {
      const groupA = a === currentProvider ? 0 : pm.hasKeyFor(a) ? 1 : 2;
      const groupB = b === currentProvider ? 0 : pm.hasKeyFor(b) ? 1 : 2;
      return groupA - groupB;
    });

    // Build grouped items with section headers
    const items: ListPickerItem[] = [];
    for (const prov of sortedProviders) {
      const models = KNOWN_MODELS.filter((m) => (m.provider ?? "anthropic") === prov);
      if (models.length === 0) continue;
      const hasKey = pm.hasKeyFor(prov);
      const headerLabel = hasKey ? prov : `${prov} (no key)`;
      items.push({ label: headerLabel, value: "", header: true });
      for (const m of models) {
        const aliases = m.aliases?.length ? m.aliases.join(", ") : "";
        items.push({ label: m.id, description: aliases, value: m.id });
      }
    }

    const selectedIdx = items.findIndex((i) => i.value === currentModelId);

    return new Promise<void>((resolve) => {
      const picker = new ListPicker(
        { title: "Model", items, selectedIndex: Math.max(0, selectedIdx) },
        async (value) => {
          handle.hide();
          ctx.requestRender();
          if (value) {
            const model = resolveModel(value);
            const provider = (model.provider ?? "anthropic") as ProviderName;

            // Check if provider has API key
            if (!ctx.config.providerManager.hasKeyFor(provider)) {
              ctx.displayLines([`  ${t.warn}No API key for ${provider}. Please enter one:${t.reset}`]);
              await promptApiKey(provider, ctx);
              if (!ctx.config.providerManager.hasKeyFor(provider)) {
                ctx.displayError("Model switch cancelled — no API key provided.");
                resolve();
                return;
              }
            }

            ctx.config.model = model;
            ctx.onModelChanged(model.id);
            ctx.displayLines([`  Model switched to ${t.bold}${model.id}${t.reset}`]);
            saveModel(model.id).catch(() => {});
          }
          resolve();
        },
      );
      const handle = ctx.showOverlay(picker, { anchor: "center" });
      ctx.requestRender();
    });
  },
};
