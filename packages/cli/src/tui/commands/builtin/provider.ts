// @summary Provider configuration command - configure LLM provider and API keys
import type { OpenAIOAuthTokens } from "@diligent/core";
import { resolveModel, runChatGPTOAuth, saveAuthKey, saveOAuthTokens } from "@diligent/core";
import { saveModel } from "../../../config-writer";
import { DEFAULT_MODELS, DEFAULT_PROVIDER, PROVIDER_HINTS, PROVIDER_NAMES, type ProviderName } from "../../../provider-manager";
import { ConfirmDialog } from "../../components/confirm-dialog";
import { ListPicker, type ListPickerItem } from "../../components/list-picker";
import { TextInput } from "../../components/text-input";
import { t } from "../../theme";
import type { Command, CommandContext } from "../types";

export const providerCommand: Command = {
  name: "provider",
  description: "Switch provider or manage API keys",
  supportsArgs: true,
  handler: async (args, ctx) => {
    const parts = args?.trim().split(/\s+/) ?? [];
    const subcommand = parts[0] ?? "";

    // /provider set <name> — set API key
    if (subcommand === "set") {
      const provider = parts[1] as ProviderName | undefined;
      if (provider && PROVIDER_NAMES.includes(provider)) {
        await promptApiKey(provider, ctx);
      } else {
        await pickProviderThenSetKey(ctx);
      }
      return;
    }

    // /provider status — show status
    if (subcommand === "status") {
      showProviderStatus(ctx);
      return;
    }

    // /provider <name> — direct switch
    if (subcommand && PROVIDER_NAMES.includes(subcommand as ProviderName)) {
      await switchProvider(subcommand as ProviderName, ctx);
      return;
    }

    // /provider (no args) — show picker to switch
    if (!subcommand) {
      await pickProvider(ctx);
      return;
    }

    ctx.displayError(`Unknown subcommand: ${subcommand}. Usage: /provider [status|set <name>|<name>]`);
  },
};

/** ListPicker to select active provider */
function pickProvider(ctx: CommandContext): Promise<void> {
  return new Promise((resolve) => {
    const currentProvider = (ctx.config.model.provider ?? DEFAULT_PROVIDER) as ProviderName;
    const items: ListPickerItem[] = PROVIDER_NAMES.map((p) => ({
      label: p,
      description: p === currentProvider ? "active" : ctx.config.providerManager.hasKeyFor(p) ? "configured" : "no key",
      value: p,
    }));
    const selectedIdx = items.findIndex((i) => i.value === currentProvider);

    const picker = new ListPicker(
      { title: "Provider", items, selectedIndex: Math.max(0, selectedIdx), filterable: false },
      async (value) => {
        handle.hide();
        ctx.requestRender();
        if (value) {
          const selected = value as ProviderName;
          if (selected === currentProvider && ctx.config.providerManager.hasKeyFor(selected)) {
            // Already active with key — offer auth change
            if (selected === "openai") {
              await promptOpenAIAuth(ctx);
            } else {
              await promptApiKey(selected, ctx);
            }
            resolve();
          } else {
            await switchProvider(selected, ctx);
            resolve();
          }
        } else {
          resolve();
        }
      },
    );
    const handle = ctx.showOverlay(picker, { anchor: "center" });
    ctx.requestRender();
  });
}

/** Switch to a provider: prompt auth if needed, then switch model to default */
async function switchProvider(provider: ProviderName, ctx: CommandContext): Promise<void> {
  if (!ctx.config.providerManager.hasKeyFor(provider)) {
    if (provider === "openai") {
      await promptOpenAIAuth(ctx);
    } else {
      await promptApiKey(provider, ctx);
    }
    if (!ctx.config.providerManager.hasKeyFor(provider)) {
      ctx.displayError("Provider switch cancelled — no API key provided.");
      return;
    }
  }

  const defaultModelId = DEFAULT_MODELS[provider];
  const model = resolveModel(defaultModelId);
  ctx.config.model = model;
  ctx.onModelChanged(model.id);
  ctx.displayLines([`  Provider: ${t.bold}${provider}${t.reset}  Model: ${t.bold}${model.id}${t.reset}`]);
  saveModel(model.id).catch(() => {});
}

/** OpenAI: show "Enter API key" vs "Login with ChatGPT" */
function promptOpenAIAuth(ctx: CommandContext): Promise<void> {
  return new Promise((resolve) => {
    const items: ListPickerItem[] = [
      {
        label: "Enter API key",
        description: "Paste sk-... key from platform.openai.com",
        value: "apikey",
      },
      {
        label: "Login with ChatGPT",
        description: "Use Plus/Pro subscription via browser OAuth",
        value: "oauth",
      },
    ];

    const picker = new ListPicker({ title: "OpenAI Authentication", items }, async (value) => {
      handle.hide();
      ctx.requestRender();

      if (value === "apikey") {
        await promptApiKey("openai", ctx);
      } else if (value === "oauth") {
        await startChatGPTOAuthFlow(ctx);
      }
      resolve();
    });

    const handle = ctx.showOverlay(picker, { anchor: "center" });
    ctx.requestRender();
  });
}

async function startChatGPTOAuthFlow(ctx: CommandContext): Promise<void> {
  ctx.displayLines(["  Opening browser for ChatGPT authentication..."]);

  try {
    const tokens = await runChatGPTOAuth({
      onUrl: (url) => {
        ctx.displayLines([`  Auth URL: ${url}`]);
      },
    });

    ctx.config.providerManager.setOAuthTokens(tokens);
    ctx.displayLines([`  ${t.success}Authenticated via ChatGPT subscription.${t.reset}`]);

    await promptSaveOAuthTokens(tokens, ctx);

    // Switch to default Codex model
    const model = resolveModel(DEFAULT_MODELS.openai);
    ctx.config.model = model;
    ctx.onModelChanged(model.id);
    ctx.displayLines([`  Model: ${t.bold}${model.id}${t.reset}`]);
    saveModel(model.id).catch(() => {});
  } catch (err) {
    ctx.displayError(`OAuth failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function promptSaveOAuthTokens(tokens: OpenAIOAuthTokens, ctx: CommandContext): Promise<void> {
  return new Promise((resolve) => {
    const dialog = new ConfirmDialog(
      {
        title: "Save Auth?",
        message: "Save ChatGPT session to ~/.config/diligent/auth.json?",
      },
      async (confirmed) => {
        handle.hide();
        ctx.requestRender();
        if (confirmed) {
          try {
            await saveOAuthTokens(tokens);
            ctx.displayLines([`  ${t.success}Saved to auth.json.${t.reset}`]);
          } catch (err) {
            ctx.displayError(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        resolve();
      },
    );
    const handle = ctx.showOverlay(dialog, { anchor: "center" });
    ctx.requestRender();
  });
}

function showProviderStatus(ctx: CommandContext): void {
  const pm = ctx.config.providerManager;
  const currentProvider = ctx.config.model.provider ?? DEFAULT_PROVIDER;
  const lines = ["", `  ${t.bold}Provider Status${t.reset}`, ""];

  for (const provider of PROVIDER_NAMES) {
    const maskedKey = pm.getMaskedKey(provider);
    const active = provider === currentProvider ? ` ${t.accent}(active)${t.reset}` : "";
    const oauthNote = provider === "openai" && pm.hasOAuthFor("openai") ? ` ${t.dim}(ChatGPT OAuth)${t.reset}` : "";
    const status = maskedKey ? `${t.success}configured${t.reset} (${maskedKey})` : `${t.dim}not configured${t.reset}`;
    const marker = pm.hasKeyFor(provider) ? "\u2713" : "\u2717";
    lines.push(`  ${marker} ${t.bold}${provider}${t.reset}: ${status}${oauthNote}${active}`);
  }

  lines.push("");
  lines.push(`  ${t.dim}Use /provider set <name> to add a key, /provider <name> to switch.${t.reset}`);
  lines.push("");

  ctx.displayLines(lines);
}

function pickProviderThenSetKey(ctx: CommandContext): Promise<void> {
  return new Promise((resolve) => {
    const items: ListPickerItem[] = PROVIDER_NAMES.map((p) => ({
      label: p,
      description: ctx.config.providerManager.hasKeyFor(p) ? "configured" : "not configured",
      value: p,
    }));

    const picker = new ListPicker({ title: "Select Provider", items }, (value) => {
      handle.hide();
      ctx.requestRender();
      if (value) {
        promptApiKey(value as ProviderName, ctx).then(resolve);
      } else {
        resolve();
      }
    });
    const handle = ctx.showOverlay(picker, { anchor: "center" });
    ctx.requestRender();
  });
}

export function promptApiKey(provider: ProviderName, ctx: CommandContext): Promise<void> {
  return new Promise((resolve) => {
    const { apiKeyUrl, apiKeyPlaceholder } = PROVIDER_HINTS[provider];

    const input = new TextInput(
      {
        title: `${provider} API Key`,
        message: `Enter your ${provider} API key (${apiKeyUrl})`,
        placeholder: apiKeyPlaceholder,
        masked: true,
      },
      (value) => {
        handle.hide();
        ctx.requestRender();
        if (value) {
          ctx.config.providerManager.setApiKey(provider, value);
          ctx.displayLines([`  ${t.success}API key set for ${provider}.${t.reset}`]);

          // Ask to save to global config
          promptSaveKey(provider, value, ctx).then(resolve);
        } else {
          resolve();
        }
      },
    );
    const handle = ctx.showOverlay(input, { anchor: "center" });
    ctx.requestRender();
  });
}

export function promptSaveKey(provider: ProviderName, apiKey: string, ctx: CommandContext): Promise<void> {
  return new Promise((resolve) => {
    const dialog = new ConfirmDialog(
      {
        title: "Save API Key?",
        message: `Save ${provider} key to ~/.config/diligent/auth.json?`,
      },
      async (confirmed) => {
        handle.hide();
        ctx.requestRender();
        if (confirmed) {
          try {
            await saveAuthKey(provider, apiKey);
            ctx.displayLines([`  ${t.success}Key saved to auth.json.${t.reset}`]);
          } catch (err) {
            ctx.displayError(`Failed to save: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        resolve();
      },
    );
    const handle = ctx.showOverlay(dialog, { anchor: "center" });
    ctx.requestRender();
  });
}
