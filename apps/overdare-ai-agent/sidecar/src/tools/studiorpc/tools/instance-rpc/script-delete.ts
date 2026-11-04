// @summary Deletes a script instance through the Studio instance.delete RPC.

import type * as scriptDelete from "../../methods/script.delete";
import { buildDeleteRender } from "../../render";
import type { ToolResult } from "../../types";
import { DEPTH_SELF, type InstanceClient } from "./client";
import { instanceTypeOf, SCRIPT_CLASSES } from "./scripts";

type ScriptDeleteArgs = ReturnType<typeof scriptDelete.params.parse>;

export async function deleteScriptViaRpc(client: InstanceClient, parsed: ScriptDeleteArgs): Promise<ToolResult> {
  const target = await client.readInstanceNode(parsed.guid, DEPTH_SELF);
  if (!target) {
    throw new Error(`ActorGuid not found in .ovdrjm: ${parsed.guid}`);
  }

  const instanceType = instanceTypeOf(target);
  if (!instanceType || !SCRIPT_CLASSES.has(instanceType)) {
    throw new Error(
      `Instance ${parsed.guid} is ${instanceType ?? "unknown"}, not a script. ` +
        "Use studiorpc_execute_luau to delete non-script instances.",
    );
  }

  await client.callInstanceRpc("instance.delete", { ActorGuids: [parsed.guid] });
  await client.saveLevelFile();

  const output = "Deleted.";
  return {
    output,
    render: buildDeleteRender("Studio script delete", parsed.guid, output),
    metadata: { method: "script.delete", targetGuid: parsed.guid },
  };
}
