// @summary Declares the Studio RPC method for validating the world's Luau scripts.
import { z } from "zod";

export const method = "lua.validate";
// Studio analyzes every script in the world when targetGuids is omitted, which
// takes far longer than an ordinary RPC round trip.
export const timeoutMs = 120_000;

export const description = `Validate the Script/LocalScript/ModuleScript instances in the Studio world using Studio's own Luau definitions and analyzer. Nothing is executed or modified.

Studio validates the sources it currently holds — there is no inline code parameter — so write a script with studiorpc_script_add / studiorpc_script_edit BEFORE validating it.

Returns a line-oriented report:
  LUA_VALIDATE v1 requested=<mode>
  OK <guid> <name> effective=<mode>            the script had nothing to report
  SCRIPT <guid> <name> effective=<mode>        the script the following diagnostics belong to
  E <category> <line>:<col>-<line>:<col> [code] <message>    error
  W <category> <line>:<col>-<line>:<col> [code] <message>    warning
  TRUNCATED diagnostics=<omitted> ...          output was capped (500 diagnostics / 131072 chars)
  SUMMARY scripts=<n> errors=<n> warnings=<n>  totals, including anything truncated

Lines and columns are 1-based; a diagnostic code is printed only when positive. Backslash, tab, CR and LF in names and messages are escaped as \\\\, \\t, \\r, \\n.

IMPORTANT: the call succeeds even when diagnostics were reported. Decide pass/fail from SUMMARY errors, not from the call returning. Zero targets returns scripts=0.`;

export const params = z.object({
  mode: z
    .enum(["strict", "nonstrict", "nocheck"])
    .optional()
    .describe(
      "Luau type-checking mode. Defaults to nonstrict, which reports real mistakes without the inference noise strict " +
        "produces. Ask for strict only to deliberately audit a script's types. A script's own --!mode comment may override it.",
    ),
  targetGuids: z
    .array(z.string().min(1))
    .optional()
    .describe("GUIDs of the scripts to validate. Omit (or pass an empty array) to validate every script in the world."),
});

/**
 * Default to nonstrict. Studio's definitions type `WaitForChild` and friends as bare
 * `Instance`, so strict flags every `button.Text` in working code: on a sample world it
 * reported 38 errors, 37 of them false ("Key 'Text' not found in class 'Instance'"), and
 * nonstrict reported the one real error alone. The generic method path does not run args
 * through `params`, so the default is applied here rather than via a zod `.default()`.
 * ponytail: revisit once Studio's type inference improves (OVDR-14507) — strict becomes
 * useful the moment its diagnostics stop being mostly noise.
 */
export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return { mode: "nonstrict", ...args };
}

/** Studio wraps the report in `{ output }`; surface the report itself as the tool output. */
export function postProcess(result: unknown): unknown {
  if (result && typeof result === "object" && typeof (result as { output?: unknown }).output === "string") {
    return (result as { output: string }).output;
  }
  return result;
}
