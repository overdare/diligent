// @summary Declares Studio's lua.validate RPC, called by the tools that write Luau.

export const method = "lua.validate";
// Studio analyzes every script in the world when targetGuids is omitted, which
// takes far longer than an ordinary RPC round trip.
export const timeoutMs = 120_000;

/**
 * Default to nonstrict.
 *
 * Measured against a live Studio world (4 scripts): strict reported 38 errors, 1 of them
 * real. The other 37 are places where the analyzer has no type to work with — 28 from a
 * generated UI helper that calls `Instance.new(className)` with a string variable, so its
 * return is bare `Instance` and every later `.Text` / `.Active` fails; 9 from
 * `WaitForChild` on a character model handed in at runtime, which no world tree can
 * resolve. Nonstrict reported the one real error alone.
 *
 * Studio itself is not the problem: a literal `WaitForChild("Name")` whose child exists in
 * the world does resolve to the real class (verified — `.Enabled` clean and `.Enabledd`
 * flagged on a LocalScript). Strict only goes quiet where our own scripts erase their types.
 *
 * The trade is legibility, not correctness: nonstrict also silences a genuine typo of that
 * same shape (`btn.Txet` on an unresolved `Instance` goes unreported).
 * ponytail: revisit strict once generated scripts keep their types — typing the ui-generator
 * helper is what makes strict useful, not a Studio change.
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
