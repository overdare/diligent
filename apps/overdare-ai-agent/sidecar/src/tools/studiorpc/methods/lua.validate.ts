// @summary Declares Studio's lua.validate RPC, called by the tools that write Luau.

export const method = "lua.validate";
// Studio analyzes every script in the world when targetGuids is omitted, which
// takes far longer than an ordinary RPC round trip.
export const timeoutMs = 120_000;

/**
 * Ask for strict.
 *
 * Strict is the mode that catches a real typo: on a resolved value it reports
 * `Key 'Enabledd' not found in class 'LocalScript'`, naming the class it checked against.
 * Nonstrict reports neither that nor the noise, so it cannot catch the mistake the agent is
 * most likely to make in a script it just wrote.
 *
 * The cost is measured: on a live world of 4 scripts strict reported 38 errors, 1 real. The
 * other 37 sit on values whose class the analyzer could not determine, and every one of them
 * says `class 'Instance'` — 28 from a generated UI helper that calls `Instance.new(className)`
 * with a string variable, 9 from `WaitForChild` on a character model handed in at runtime.
 * A diagnostic naming a concrete class is a real defect; one naming `Instance` means the
 * analyzer had no type to check against.
 *
 * ponytail: the noise is ours to remove — teaching the ui-generator helper to take the
 * instance rather than the class name keeps the type, and those 28 stop existing.
 */
export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  return { mode: "strict", ...args };
}

/** Studio wraps the report in `{ output }`; surface the report itself as the tool output. */
export function postProcess(result: unknown): unknown {
  if (result && typeof result === "object" && typeof (result as { output?: unknown }).output === "string") {
    return (result as { output: string }).output;
  }
  return result;
}
