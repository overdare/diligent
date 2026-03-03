// @summary Factory for config reload and collaboration mode switching
import type { DiligentPaths, SkillMetadata } from "@diligent/core";
import type { Mode as ProtocolMode } from "@diligent/protocol";
import type { AppConfig } from "../config";
import { loadConfig } from "../config";
import { registerBuiltinCommands } from "./commands/builtin/index";
import { CommandRegistry } from "./commands/registry";
import type { LocalAppServerRpcClient } from "./rpc-client";

export interface ConfigManagerDeps {
  getRpcClient: () => LocalAppServerRpcClient | null;
  getCurrentThreadId: () => string | null;
  getConfig: () => AppConfig;
  setConfig: (config: AppConfig) => void;
  getPaths: () => DiligentPaths | undefined;
  setCurrentMode: (mode: ProtocolMode) => void;
  setSkills: (skills: SkillMetadata[]) => void;
  setCommandRegistry: (registry: CommandRegistry) => void;
  updateStatusBar: (updates: Record<string, unknown>) => void;
  displayError: (msg: string) => void;
  requestRender: () => void;
}

export interface ConfigManager {
  setMode: (mode: ProtocolMode) => void;
  reloadConfig: () => Promise<void>;
}

export function createConfigManager(deps: ConfigManagerDeps): ConfigManager {
  return {
    setMode(mode: ProtocolMode): void {
      deps.setCurrentMode(mode);
      deps.updateStatusBar({ mode });
      const rpc = deps.getRpcClient();
      const threadId = deps.getCurrentThreadId();
      if (rpc && threadId) {
        void rpc.request("mode/set", { threadId, mode }).catch(() => {});
      }
      deps.requestRender();
    },

    async reloadConfig(): Promise<void> {
      try {
        const newConfig = await loadConfig(process.cwd(), deps.getPaths());
        deps.setConfig(newConfig);
        deps.setSkills(newConfig.skills ?? []);

        // Rebuild command registry with new skills
        const registry = new CommandRegistry();
        registerBuiltinCommands(registry, newConfig.skills ?? []);
        deps.setCommandRegistry(registry);

        deps.updateStatusBar({ model: newConfig.model.id, contextWindow: newConfig.model.contextWindow });
      } catch (err) {
        deps.displayError(`Reload error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
