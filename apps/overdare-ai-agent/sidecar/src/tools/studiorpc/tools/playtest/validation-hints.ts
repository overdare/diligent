// @summary Maps strict Luau validator output to concise, deduplicated harness fix hints.

const INPUT_EVENT_FIELDS = /\b(?:pitchDegrees|yawDegrees|durationMs|action|key|deltaX|deltaY)\b/;

/**
 * Turns `lua.validate` strict-mode errors into short repair hints. Pure: unknown codes produce no
 * hint, and each hint appears once however many lines trigger it.
 */
export function validationHints(output: string): string[] {
  const hints = new Set<string>();
  for (const line of output.split("\n")) {
    const match = /\b(10\d\d)\b\s+(.*)$/.exec(line);
    if (!match) continue;
    const [, code, message = ""] = match;
    if (code === "1029" && /Table type/.test(message) && INPUT_EVENT_FIELDS.test(message)) {
      hints.add(
        "1029 mixed input-event tables: build events with the managed DiligentPlaytestAPI constructors (P.key, P.wait, P.look, ...) or annotate the list as {P.Event} instead of hand-writing tables.",
      );
    } else if (code === "1002" && /Key '[^']+' not found in class '[^']+'/.test(message)) {
      hints.add(
        "1002 unknown member: strict types do not know live children or runtime services; use FindFirstChild/WaitForChild and cast the result (for example `:: RemoteEvent` or `:: any`).",
      );
    } else if (code === "1007" && /returns \d+ values?, but \d+ are required/.test(message)) {
      hints.add(
        "1007 return count mismatch: declare the function return type (for example `(): (boolean, string?)`) so every return path matches its callers.",
      );
    }
  }
  return [...hints];
}
