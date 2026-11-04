// @summary Deletes a script instance through the Studio instance.delete RPC.

import type * as scriptDelete from "../../methods/script.delete";
import { buildDeleteRender } from "../../render";
import type { ToolResult } from "../../types";
import { callInstanceRpc, DEPTH_SELF, readInstanceNode, saveLevelFile } from "./client";
import { instanceTypeOf, SCRIPT_CLASSES } from "./scripts";

type ScriptDeleteArgs = ReturnType<typeof scriptDelete.params.parse>;

export async function deleteScriptViaRpc(parsed: ScriptDeleteArgs): Promise<ToolResult> {
  const target = await readInstanceNode(parsed.guid, DEPTH_SELF);
  if (!target) {
    throw new Error(`ActorGuid not found in .ovdrjm: ${parsed.guid}`);
  }

  const instanceType = instanceTypeOf(target);
  if (!instanceType || !SCRIPT_CLASSES.has(instanceType)) {
    throw new Error(
      `Instance ${parsed.guid} is ${instanceType ?? "unknown"}, not a script. ` +
        "Use studiorpc_instance_delete to delete non-script instances.",
    );
  }

  await callInstanceRpc("instance.delete", { ActorGuids: [parsed.guid] });
  try {
    await saveLevelFile();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Script deletion succeeded (GUID: ${parsed.guid}), but level.save.file failed: ${reason}. ` +
        "The save outcome is unknown. Do not repeat deletion; inspect Studio and verify the saved state.",
    );
  }

  const output = "Deleted.";
  return {
    output,
    render: buildDeleteRender("Studio script delete", parsed.guid, output),
    metadata: { method: "script.delete", targetGuid: parsed.guid },
  };
}
