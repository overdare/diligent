// @summary Executes Luau directly in the active Editor world with explicit mutation semantics.
import { z } from "zod";

export const method = "execute.luau";
export const description =
  "Edit the active Editor world with Luau (not PIE). Use the provided workspace or game.Workspace and ordinary nil checks; game:GetService and the gameplay isnil helper are not supported by the Editor VM. Each call has an independent VM: globals/references do not persist, world edits do. Supports instance creation, reads, properties, parenting, deletion, attributes, and Script.Source within Studio's editable API. This tool automatically saves the level after successful execution; do not request another save for the same edits. A save failure reports that execution already succeeded: do not replay the code. Returns the FIRST return value as a string, not print logs; nil/no return is 'nil', supported tables are JSON strings (parse once). This value is authored by the submitted code, not an asynchronous generation report. Observe later generated output separately before claiming success; an empty result alone does not identify a generation failure's cause. Return a concise verification summary. Cannot delete/reparent the DataModel root or detach existing objects into temporary hierarchies. Unparented new temporary objects are cleaned up. Ordinary edits share command Undo; Script.Source file restoration is not covered by the same guarantee. Inspect command_id, mutation_attempted and undo_recorded on failure. If mutation_attempted is false, correct the code before a new call; otherwise inspect the current world before recovery. Never automatically replay failed code. Rejects PIE transitions/running PIE, other Editor transactions, and collaborative editing. Limits: UTF-8 source 256 KiB, result string 64 KiB, 1,024 explicit creations, 5 seconds Lua execution; a native call cannot be preempted.";
export const params = z
  .object({
    target: z.literal("Editor"),
    code: z
      .string()
      .refine((code) => !code.includes("\0"), "Source must not contain NUL")
      .refine((code) => Buffer.byteLength(code, "utf8") <= 256 * 1024, "Source must be at most 256 KiB UTF-8"),
  })
  .strict();
