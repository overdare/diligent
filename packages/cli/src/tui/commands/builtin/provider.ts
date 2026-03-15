// @summary Provider configuration command - configure LLM provider and API keys
import { resolveModel } from "@diligent/core";
import { DILIGENT_CLIENT_REQUEST_METHODS } from "@diligent/protocol";
import { createChatGPTOAuthBinding, removeAuthKey, removeOAuthTokens, saveAuthKey } from "@diligent/runtime";
import { saveModel } from "../../../config-writer";
import {
  DEFAULT_MODELS,
  DEFAULT_PROVIDER,
  PROVIDER_HINTS,
  PROVIDER_NAMES,
  type ProviderName,
} from "../../../provider-manager";
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

    // /provider set <name> — set auth
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
            await manageConnectedProvider(selected, ctx);
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

type ConnectedProviderAction = "reconnect" | "disconnect" | null;

async function manageConnectedProvider(provider: ProviderName, ctx: CommandContext): Promise<void> {
  const action = await pickConnectedProviderAction(provider, ctx);
  if (!action) {
    return;
  }

  if (action === "reconnect") {
    if (provider === "chatgpt") {
      await startChatGPTOAuthFlow(ctx);
      return;
    }
    await promptApiKey(provider, ctx);
    return;
  }

  await disconnectProvider(provider, ctx);
}

function pickConnectedProviderAction(provider: ProviderName, ctx: CommandContext): Promise<ConnectedProviderAction> {
  return new Promise((resolve) => {
    const items: ListPickerItem[] = [
      {
        label: "Reconnect",
        description: provider === "chatgpt" ? "Run OAuth login again" : "Replace saved API key",
        value: "reconnect",
      },
      {
        label: "Disconnect",
        description: provider === "chatgpt" ? "Remove OAuth session" : "Remove saved API key",
        value: "disconnect",
      },
      { label: "Cancel", description: "Keep current authentication", value: "cancel" },
    ];

    const picker = new ListPicker(
      {
        title: `${provider} is already connected`,
        items,
        selectedIndex: 0,
        filterable: false,
      },
      (value) => {
        handle.hide();
        ctx.requestRender();
        if (!value || value === "cancel") {
          resolve(null);
          return;
        }
        resolve(value as ConnectedProviderAction);
      },
    );
    const handle = ctx.showOverlay(picker, { anchor: "center" });
    ctx.requestRender();
  });
}

/** Switch to a provider: prompt auth if needed, then switch model to default */
async function switchProvider(provider: ProviderName, ctx: CommandContext): Promise<void> {
  if (!ctx.config.providerManager.hasKeyFor(provider)) {
    if (provider === "chatgpt") {
      await startChatGPTOAuthFlow(ctx);
    } else {
      await promptApiKey(provider, ctx);
    }
    if (!ctx.config.providerManager.hasKeyFor(provider)) {
      ctx.displayError("Provider switch cancelled — no authentication configured.");
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

export async function disconnectProvider(provider: ProviderName, ctx: CommandContext): Promise<void> {
  const confirmed = await ctx.app.confirm({
    title: "Disconnect provider",
    message:
      provider === "chatgpt"
        ? "Disconnect ChatGPT OAuth and remove saved authentication?"
        : `Remove saved API key for ${provider}?`,
    confirmLabel: "Disconnect",
    cancelLabel: "Cancel",
  });

  if (!confirmed) {
    return;
  }

  try {
    const rpc = ctx.app.getRpcClient?.();
    if (rpc) {
      await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.AUTH_REMOVE, { provider });
    } else {
      await removeAuthKey(provider);
      if (provider === "chatgpt") {
        await removeOAuthTokens();
      }
    }

    ctx.config.providerManager.removeApiKey(provider);
    if (provider === "chatgpt") {
      ctx.config.providerManager.removeExternalAuth("chatgpt");
    }

    ctx.displayLines([`  ${t.success}Disconnected ${provider}.${t.reset}`]);
  } catch (err) {
    ctx.displayError(`Failed to disconnect ${provider}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function startChatGPTOAuthFlow(ctx: CommandContext): Promise<void> {
  const rpc = ctx.app.getRpcClient?.();
  if (!rpc) {
    ctx.displayError("App server not available. Cannot start OAuth flow.");
    return;
  }

  ctx.displayLines(["  Opening browser for ChatGPT authentication..."]);

  try {
    // Delegate OAuth to app-server so its providerManager receives the tokens directly
    const { authUrl } = await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.AUTH_OAUTH_START, { provider: "chatgpt" });
    ctx.displayLines([`  Auth URL: ${t.dim}${authUrl}${t.reset}`]);

    // Wait for ACCOUNT_LOGIN_COMPLETED notification forwarded via app.ts
    const waitFn = ctx.app.waitForOAuthComplete;
    if (!waitFn) {
      ctx.displayError("OAuth completion handler not available.");
      return;
    }
    const result = await waitFn();

    if (!result.success) {
      ctx.displayError(`OAuth failed: ${result.error ?? "Unknown error"}`);
      return;
    }

    ctx.displayLines([`  ${t.success}Authenticated via ChatGPT subscription.${t.reset}`]);

    // Mark chatgpt as configured in the TUI's local providerManager (cosmetic — app-server has real tokens)
    const localOAuth = createChatGPTOAuthBinding({
      initialTokens: {
        access_token: "chatgpt-oauth",
        refresh_token: "chatgpt-oauth",
        id_token: "chatgpt-oauth",
        expires_at: Number.MAX_SAFE_INTEGER,
      },
    });
    ctx.config.providerManager.setExternalAuth("chatgpt", localOAuth.auth);

    // Switch to default Codex model
    const model = resolveModel(DEFAULT_MODELS.chatgpt);
    ctx.config.model = model;
    ctx.onModelChanged(model.id);
    ctx.displayLines([`  Model: ${t.bold}${model.id}${t.reset}`]);
    saveModel(model.id).catch(() => {});
  } catch (err) {
    ctx.displayError(`OAuth failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function showProviderStatus(ctx: CommandContext): void {
  const pm = ctx.config.providerManager;
  const currentProvider = ctx.config.model.provider ?? DEFAULT_PROVIDER;
  const lines = ["", `  ${t.bold}Provider Status${t.reset}`, ""];

  for (const provider of PROVIDER_NAMES) {
    const maskedKey = pm.getMaskedKey(provider);
    const active = provider === currentProvider ? ` ${t.accent}(active)${t.reset}` : "";
    const oauthNote = provider === "chatgpt" && pm.hasOAuthFor("chatgpt") ? ` ${t.dim}(OAuth)${t.reset}` : "";
    const status = maskedKey ? `${t.success}configured${t.reset} (${maskedKey})` : `${t.dim}not configured${t.reset}`;
    const marker = pm.hasKeyFor(provider) ? "\u2713" : "\u2717";
    lines.push(`  ${marker} ${t.bold}${provider}${t.reset}: ${status}${oauthNote}${active}`);
  }

  lines.push("");
  lines.push(`  ${t.dim}Use /provider set <name> to add auth, /provider <name> to switch.${t.reset}`);
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
  if (provider === "chatgpt") {
    return startChatGPTOAuthFlow(ctx);
  }
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
        message: `Save ${provider} key to ~/.diligent/auth.jsonc?`,
      },
      async (confirmed) => {
        handle.hide();
        ctx.requestRender();
        if (confirmed) {
          try {
            const rpc = ctx.app.getRpcClient?.();
            if (rpc) {
              await rpc.request(DILIGENT_CLIENT_REQUEST_METHODS.AUTH_SET, { provider, apiKey });
            } else {
              await saveAuthKey(provider, apiKey);
            }
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
