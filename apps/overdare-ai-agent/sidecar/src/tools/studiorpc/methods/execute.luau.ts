// @summary Executes Luau directly in the active Editor world with explicit mutation semantics.
import { z } from "zod";

export const method = "execute.luau";
export const description =
  "Execute Luau in the active Editor world (game/workspace), not PIE. Each call has an independent VM: globals/references do not persist, world edits do. Supports instance and attribute edits and Script.Source within Studio's editable API. Returns the FIRST return value as a string, not print logs; nil/no return is 'nil', supported tables are JSON strings (parse once). Cannot delete/reparent the DataModel root or detach existing objects into temporary hierarchies. Unparented new temporary objects are cleaned up. Ordinary edits share command Undo; Script.Source file restoration is not covered by the same guarantee. Errors may leave partial edits: inspect command_id, mutation_attempted, undo_recorded and current world state before any retry. Rejects PIE transitions/running PIE, other Editor transactions, and collaborative editing. Limits: UTF-8 source 256 KiB, result string 64 KiB, 1,024 explicit creations, 5 seconds Lua execution; a native call cannot be preempted.";
export const params = z
  .object({
    target: z.literal("Editor"),
    code: z
      .string()
      .refine((code) => !code.includes("\0"), "Source must not contain NUL")
      .refine((code) => Buffer.byteLength(code, "utf8") <= 256 * 1024, "Source must be at most 256 KiB UTF-8"),
  })
  .strict();
