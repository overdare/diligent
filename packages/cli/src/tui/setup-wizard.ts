// @summary Factory for first-run provider selection and API key setup wizard
import { resolveModel } from "@diligent/runtime";
import type { AppConfig } from "../config";
import {
  DEFAULT_MODELS,
  DEFAULT_PROVIDER,
  PROVIDER_HINTS,
  PROVIDER_NAMES,
  type ProviderName,
} from "../provider-manager";
import { promptSaveKey } from "./commands/builtin/provider";
import type { CommandContext } from "./commands/types";
import type { ListPickerItem } from "./components/list-picker";
import { ListPicker } from "./components/list-picker";
import { TextInput } from "./components/text-input";
import type { Component, OverlayHandle, OverlayOptions } from "./framework/types";
import { t } from "./theme";

export interface SetupWizardDeps {
  config: AppConfig;
  addLines: (lines: string[]) => void;
  requestRender: () => void;
  showOverlay: (component: Component, options?: OverlayOptions) => OverlayHandle;
  buildCommandContext: () => CommandContext;
  updateStatusBar: (updates: Record<string, unknown>) => void;
}

export interface SetupWizard {
  runSetupWizard: () => Promise<void>;
}

export function createSetupWizard(deps: SetupWizardDeps): SetupWizard {
  function wizardPickProvider(): Promise<ProviderName | null> {
    return new Promise((resolve) => {
      const items: ListPickerItem[] = PROVIDER_NAMES.map((p) => ({
        label: p,
        description: deps.config.providerManager.hasKeyFor(p) ? "configured" : "no key",
        value: p,
      }));

      const picker = new ListPicker({ title: "Select Provider", items }, (value) => {
        handle.hide();
        deps.requestRender();
        resolve(value as ProviderName | null);
      });
      const handle = deps.showOverlay(picker, { anchor: "center" });
      deps.requestRender();
    });
  }

  function wizardEnterApiKey(provider: ProviderName): Promise<string | null> {
    return new Promise((resolve) => {
      const { apiKeyUrl: hint, apiKeyPlaceholder: placeholder } = PROVIDER_HINTS[provider];

      const input = new TextInput(
        {
          title: `${provider} API Key`,
          message: `Enter your ${provider} API key (${hint})`,
          placeholder,
          masked: true,
        },
        (value) => {
          handle.hide();
          deps.requestRender();
          resolve(value);
        },
      );
      const handle = deps.showOverlay(input, { anchor: "center" });
      deps.requestRender();
    });
  }

  return {
    async runSetupWizard(): Promise<void> {
      deps.addLines(["", `  ${t.warn}No API key found.${t.reset} Let's set one up.`, ""]);
      deps.requestRender();

      // Step 1: Pick provider
      const provider = await wizardPickProvider();
      if (!provider) {
        deps.addLines([
          `  ${t.dim}Setup skipped. Use /provider set <anthropic|openai> to configure later.${t.reset}`,
          "",
        ]);
        deps.requestRender();
        return;
      }

      // Step 2: Enter API key
      const apiKey = await wizardEnterApiKey(provider);
      if (!apiKey) {
        deps.addLines([`  ${t.dim}Setup skipped. Use /provider set ${provider} to configure later.${t.reset}`, ""]);
        deps.requestRender();
        return;
      }

      // Apply key immediately
      deps.config.providerManager.setApiKey(provider, apiKey);

      // Step 3: Save to global config?
      const ctx = deps.buildCommandContext();
      await promptSaveKey(provider, apiKey, ctx);

      // Switch model if the selected provider differs from current
      const currentProvider = deps.config.model.provider ?? DEFAULT_PROVIDER;
      if (currentProvider !== provider) {
        const defaultModelId = DEFAULT_MODELS[provider];
        deps.config.model = resolveModel(defaultModelId);
        deps.updateStatusBar({ model: deps.config.model.id });
      }

      deps.addLines([`  ${t.success}Ready!${t.reset} Using ${t.bold}${deps.config.model.id}${t.reset}`, ""]);
      deps.requestRender();
    },
  };
}
