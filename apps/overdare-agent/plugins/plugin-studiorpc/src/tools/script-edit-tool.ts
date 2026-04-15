// @summary Edits a script's Source property in .ovdrjm via exact string replacement.
import type { Tool, ToolContext, ToolResult } from "@diligent/plugin-sdk";
import * as scriptEdit from "../methods/script.edit.ts";
import { buildScriptEditRender } from "../render.ts";
import { applyAndSave } from "../rpc.ts";
import type { WriteLock } from "../write-lock.ts";
import {
  findNodeByActorGuid,
  isRecord,
  normalizeLeadingSpaces,
  normalizeLineEndings,
  type OvdrjmNode,
  readAndWriteOvdrjm,
} from "./ovdrjm-utils.ts";

// ---------------------------------------------------------------------------
// Helpers — mirrored from packages/runtime/src/tools/edit.ts
// ---------------------------------------------------------------------------

interface SingleEdit {
  old_string: string;
  new_string: string;
  replace_all: boolean;
}

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

/**
 * Validate and apply a single edit to `content`, returning the new content and
 * the number of replacements made. Throws on validation failure.
 */
function applyEdit(content: string, edit: SingleEdit): { result: string; count: number } {
  const { old_string, new_string, replace_all } = edit;

  if (old_string === new_string) {
    throw new Error("old_string and new_string must differ");
  }

  const occurrences = countOccurrences(content, old_string);

  if (replace_all) {
    if (occurrences === 0) {
      throw new Error("old_string not found in file");
    }
    return { result: content.replaceAll(old_string, new_string), count: occurrences };
  }

  // Unique match mode
  if (occurrences === 0) {
    throw new Error("old_string not found in file");
  }
  if (occurrences > 1) {
    throw new Error("old_string is not unique, provide more context or use replace_all");
  }

  return { result: content.replace(old_string, new_string), count: 1 };
}

// ---------------------------------------------------------------------------
// Script class guard
// ---------------------------------------------------------------------------

const SCRIPT_CLASSES = new Set(["Script", "LocalScript", "ModuleScript"]);

// ---------------------------------------------------------------------------
// script_edit tool
// ---------------------------------------------------------------------------

function toToolName(method: string): string {
  return `studiorpc_${method.replace(/\./g, "_")}`;
}

async function executeScriptEdit(
  args: Record<string, unknown>,
  ctx: ToolContext,
  cwd: string,
  writeLock: WriteLock,
): Promise<ToolResult> {
  const toolName = toToolName(scriptEdit.method);
  const parsed = scriptEdit.params.parse(args);
  const { targetGuid, old_string, new_string, replace_all } = parsed;

  if (old_string === "") {
    return { output: "Error: old_string cannot be empty for script edit", metadata: { error: true } };
  }

  // --- Approval ---
  const approval = await ctx.approve({
    permission: "write",
    toolName,
    description: `Edit script ${targetGuid}`,
    details: { targetGuid, old_string, new_string, replace_all },
  });
  if (approval === "reject") {
    return { output: "[Rejected by user]", metadata: { error: true } };
  }

  // --- Read .ovdrjm, apply edit, write back ---
  const release = await writeLock.acquire();
  try {
    let count = 0;
    let tabCount = 0;
    let eolCount = 0;
    let scriptName: string | undefined;

    readAndWriteOvdrjm(cwd, (rootDoc) => {
      const root = rootDoc.Root;
      if (!isRecord(root)) {
        throw new Error("Invalid .ovdrjm format: Root object is missing.");
      }

      const target = findNodeByActorGuid(root as OvdrjmNode, targetGuid);
      if (!target) {
        throw new Error(`ActorGuid not found in .ovdrjm: ${targetGuid}`);
      }

      const instanceType = typeof target.InstanceType === "string" ? target.InstanceType : undefined;
      if (!instanceType || !SCRIPT_CLASSES.has(instanceType)) {
        throw new Error(
          `Instance ${targetGuid} is ${instanceType ?? "unknown"}, not a script. ` +
            "Use studiorpc_instance_upsert to edit non-script instances.",
        );
      }

      scriptName = typeof target.Name === "string" ? target.Name : undefined;
      const source = typeof target.Source === "string" ? target.Source : "";

      const { result, count: editCount } = applyEdit(source, { old_string, new_string, replace_all });

      // Normalize leading 4-spaces → tabs, then line endings for the current OS
      const normalized = normalizeLeadingSpaces(result);
      const eolNormalized = normalizeLineEndings(normalized.result);
      target.Source = eolNormalized.result;
      tabCount = normalized.converted;
      eolCount = eolNormalized.converted;
      count = editCount;
    });

    await applyAndSave();

    let output = `Edited script ${targetGuid}: replaced ${count} occurrence(s)`;
    const normalizations: string[] = [];
    if (tabCount > 0) normalizations.push(`${tabCount} leading 4-space group(s) → tabs`);
    if (eolCount > 0) normalizations.push(`${eolCount} line ending(s) normalized`);
    if (normalizations.length > 0) output += ` (${normalizations.join(", ")})`;
    return {
      output,
      render: buildScriptEditRender({ targetGuid, scriptName, old_string, new_string, replace_all }, output, count),
      metadata: { method: "script.edit", targetGuid, count },
    };
  } catch (err) {
    return {
      output: `Error: ${err instanceof Error ? err.message : String(err)}`,
      metadata: { error: true },
    };
  } finally {
    release();
  }
}

export function createScriptEditTool(cwd: string, writeLock: WriteLock): Tool {
  return {
    name: toToolName(scriptEdit.method),
    description: scriptEdit.description,
    parameters: scriptEdit.params,
    async execute(args, ctx) {
      return executeScriptEdit(args, ctx, cwd, writeLock);
    },
  };
}
