// @summary Edits a script's Source through instance.read followed by instance.update.

import type * as scriptEdit from "../../methods/script.edit";
import { buildScriptEditRender } from "../../render";
import type { ToolResult } from "../../types";
import { normalizeLeadingSpaces, normalizeLineEndings } from "../ovdrjm-utils";
import { applyEdit } from "../script-edit-tool";
import { callInstanceRpc, DEPTH_SELF, readInstanceNode, saveLevelFile } from "./client";
import { instanceTypeOf, RECIPE_CLASSES, SOURCE_CLASSES } from "./scripts";

type ScriptEditArgs = ReturnType<typeof scriptEdit.params.parse>;

export async function editScriptViaRpc(parsed: ScriptEditArgs): Promise<ToolResult> {
  const { guid: targetGuid, old_string, new_string, replace_all } = parsed;

  const target = await readInstanceNode(targetGuid, DEPTH_SELF);
  if (!target) {
    throw new Error(`ActorGuid not found in .ovdrjm: ${targetGuid}`);
  }

  const instanceType = instanceTypeOf(target);
  if (!instanceType || !SOURCE_CLASSES.has(instanceType)) {
    throw new Error(
      `Instance ${targetGuid} is ${instanceType ?? "unknown"}, which has no Source to edit. ` +
        "Use studiorpc_instance_upsert to edit other instances.",
    );
  }
  const isRecipe = RECIPE_CLASSES.has(instanceType);

  const scriptName = typeof target.Name === "string" ? target.Name : undefined;
  const source = typeof target.Source === "string" ? target.Source : "";

  const { result: edited, count } = applyEdit(source, { old_string, new_string, replace_all });
  // Lua source is normalized to tabs; a Python recipe is not, because mixing tabs into
  // space-indented Python is a TabError, not a style difference.
  const normalized = isRecipe ? { result: edited, converted: 0 } : normalizeLeadingSpaces(edited);
  const eolNormalized = normalizeLineEndings(normalized.result);

  await callInstanceRpc("instance.update", {
    Instances: [{ ActorGuid: targetGuid, Source: eolNormalized.result }],
  });
  await saveLevelFile();

  let output = `Edited ${isRecipe ? "recipe" : "script"} ${targetGuid}: replaced ${count} occurrence(s)`;
  const normalizations: string[] = [];
  if (normalized.converted > 0) normalizations.push(`${normalized.converted} leading 4-space group(s) → tabs`);
  if (eolNormalized.converted > 0) normalizations.push(`${eolNormalized.converted} line ending(s) normalized`);
  if (normalizations.length > 0) output += ` (${normalizations.join(", ")})`;

  return {
    output,
    render: buildScriptEditRender({ targetGuid, scriptName, old_string, new_string, replace_all }, output, count),
    metadata: { method: "script.edit", targetGuid, count },
  };
}
