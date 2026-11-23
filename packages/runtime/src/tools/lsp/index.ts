// @summary Public surface of the language server integration: the lsp tool, post-write hook, and process-wide manager
import type { Tool } from "@diligent/core/tool-contract";
import type { LspConfig } from "../../config/schema";
import type { RuntimeToolHost } from "../capabilities";
import { getLspManager } from "./manager";
import { createPostWriteHook, type PostWriteHook } from "./post-edit";
import { createLspTool } from "./tool";
import { LspWorkspace } from "./workspace";

export { LspClient } from "./client";
export { getLspManager, LspManager, type LspManagerOptions, type LspServerStatus, shutdownLspManager } from "./manager";
export { createPostWriteHook, type PostWriteHook, type WrittenFile } from "./post-edit";
export { DEFAULT_LSP_SERVERS, type LspServerSpec, resolveCommand, resolveLspServers } from "./servers";
export { createLspTool, LSP_TOOL_NAME } from "./tool";
export { LspWorkspace } from "./workspace";

export interface LspIntegration {
  tool: Tool;
  postWrite: PostWriteHook;
}

/** The `lsp` tool and the write tools' post-write hook for one working directory; `undefined` when disabled. */
export function createLspIntegration(
  cwd: string,
  config: LspConfig | undefined,
  host: RuntimeToolHost | undefined,
): LspIntegration | undefined {
  if (config?.enabled === false) return undefined;
  const workspace = new LspWorkspace(cwd, getLspManager(), config);
  return { tool: createLspTool({ workspace, host }), postWrite: createPostWriteHook(workspace) };
}
