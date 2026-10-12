// @summary Declares Studio's lua.validate RPC, called by the tools that write Luau.

export const method = "lua.validate";
// Studio analyzes every script in the world when targetGuids is omitted, which
// takes far longer than an ordinary RPC round trip.
export const timeoutMs = 120_000;

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
