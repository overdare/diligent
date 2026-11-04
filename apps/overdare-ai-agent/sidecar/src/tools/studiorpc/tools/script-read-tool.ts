// @summary Registers the script read tool, which returns a script's Source with line numbers.

import * as scriptRead from "../methods/script.read";
import type { Tool } from "../types";
import type { InstanceClient } from "./instance-rpc/client";
import { readScriptViaRpc } from "./instance-rpc/script-read";

function toToolName(method: string): string {
  return `studiorpc_${method.replace(/\./g, "_")}`;
}

export function createScriptReadTool(client: InstanceClient): Tool {
  return {
    name: toToolName(scriptRead.method),
    description: scriptRead.description,
    parameters: scriptRead.params,
    async execute(args) {
      return readScriptViaRpc(client, scriptRead.params.parse(args));
    },
  };
}
