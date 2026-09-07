// @summary Shared script-instance constants for the Studio v2 script tools.

export const SCRIPT_CLASSES = new Set(["Script", "LocalScript", "ModuleScript"]);

/*
 * Instances whose `Source` the script tools may read and edit.
 *
 * A ProceduralModel is not a script -- its Source is a Python recipe, not Lua -- but it is the same
 * property, edited for the same reason: something in the text is wrong and one line of it needs to
 * change. Routing that through instance.upsert instead would mean resending the whole recipe to
 * change a number, which is how a working recipe gets clobbered by a truncated one.
 *
 * SCRIPT_CLASSES stays as it is for everything that treats Source as Lua -- grep, validate, delete.
 * Deleting a ProceduralModel is a level edit, not a script edit, and validating Python against a
 * Lua parser would report nothing but noise.
 */
export const SOURCE_CLASSES = new Set([...SCRIPT_CLASSES, "ProceduralModel"]);

/** Python is indentation-sensitive, so a recipe must not have its leading spaces turned into tabs. */
export const RECIPE_CLASSES = new Set(["ProceduralModel"]);

export function instanceTypeOf(node: Record<string, unknown>): string | undefined {
  return typeof node.InstanceType === "string" ? node.InstanceType : undefined;
}
