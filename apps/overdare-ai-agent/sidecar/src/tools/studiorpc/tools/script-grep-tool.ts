// @summary Searches for a regex pattern across script Source properties in the Editor level.

import * as scriptGrep from "../methods/script.grep";
import type { Tool } from "../types";
import type { InstanceClient } from "./instance-rpc/client";
import { grepScriptsViaRpc } from "./instance-rpc/script-grep";
import type { OvdrjmNode } from "./ovdrjm-utils";

const SCRIPT_CLASSES = new Set(["Script", "LocalScript", "ModuleScript"]);
const MAX_MATCHES = 100;
const MAX_LINE_LENGTH = 2000;

function toToolName(method: string): string {
  return `studiorpc_${method.replace(/\./g, "_")}`;
}

interface MatchLine {
  scriptName: string;
  scriptGuid: string;
  lineNum: number;
  text: string;
}

/**
 * Walk the subtree rooted at `node`, grep each script's Source line-by-line,
 * and yield matches incrementally so we never buffer all sources in memory.
 */
function grepSubtree(node: OvdrjmNode, regex: RegExp, out: MatchLine[], limit: number): number {
  let total = 0;
  const instanceType = typeof node.InstanceType === "string" ? node.InstanceType : undefined;

  if (instanceType && SCRIPT_CLASSES.has(instanceType)) {
    const source = typeof node.Source === "string" ? node.Source : "";
    const guid = typeof node.ActorGuid === "string" ? node.ActorGuid : "";
    const name = typeof node.Name === "string" ? node.Name : "unnamed";

    // Reset lastIndex for stateless matching per script
    let pos = 0;
    let lineNum = 0;
    while (pos <= source.length) {
      const nl = source.indexOf("\n", pos);
      const lineEnd = nl === -1 ? source.length : nl;
      const line = source.slice(pos, lineEnd);
      lineNum++;

      if (regex.test(line)) {
        total++;
        if (out.length < limit) {
          out.push({
            scriptName: name,
            scriptGuid: guid,
            lineNum,
            text: line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line,
          });
        }
      }

      if (nl === -1) break;
      pos = nl + 1;
    }
  }

  if (Array.isArray(node.LuaChildren)) {
    for (const child of node.LuaChildren) {
      if (typeof child === "object" && child !== null) {
        total += grepSubtree(child as OvdrjmNode, regex, out, limit);
      }
    }
  }

  return total;
}

/** Count scripts in subtree (for metadata). */
function countScripts(node: OvdrjmNode): number {
  let count = 0;
  const instanceType = typeof node.InstanceType === "string" ? node.InstanceType : undefined;
  if (instanceType && SCRIPT_CLASSES.has(instanceType)) count++;
  if (Array.isArray(node.LuaChildren)) {
    for (const child of node.LuaChildren) {
      if (typeof child === "object" && child !== null) {
        count += countScripts(child as OvdrjmNode);
      }
    }
  }
  return count;
}

export function createScriptGrepTool(client: InstanceClient): Tool {
  return {
    name: toToolName(scriptGrep.method),
    description: scriptGrep.description,
    parameters: scriptGrep.params,
    async execute(args) {
      return grepScriptsViaRpc(client, scriptGrep.params.parse(args));
    },
  };
}

export { countScripts, grepSubtree, MAX_MATCHES };
export type { MatchLine };
