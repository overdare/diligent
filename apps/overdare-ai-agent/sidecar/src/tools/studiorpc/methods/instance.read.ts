import { z } from "zod";

export const method = "instance.read";

export const description =
  "Read authored instance JSON by GUID, using Studio RPC by default or the saved level in the legacy file backend. " +
  "Returns properties without a local class whitelist. Use recursive to include descendants. " +
  "WorldTransform is returned when provided by Studio or the saved level, alongside Size when present, for spatial inspection and camera placement. WorldTransform is a read-only derived cache; its presence does not imply writability. Use live schema search to find writable transform properties. " +
  "For gameplay state during a play test, use studiorpc_game_observe instead.";

export const params = z.object({
  // Optional in the schema so that calling with no arguments — which three testers did,
  // expecting the live tool's listing — is answered with a sentence naming the tool they
  // wanted, instead of a bare "guid: Required" from the validator.
  guid: z
    .string()
    .optional()
    .describe(
      "GUID of the instance to read. Tools that report a GUID name it instanceGuid; pass that same value here. " +
        "This tool has no listing mode: for everything in the running game, call " +
        "studiorpc_game_observe with instances set to search the world.",
    ),
  recursive: z.boolean().describe("If true, include all descendants recursively").default(false),
});

/** Accepts instanceGuid, the name every tool that reports a GUID uses, as guid. */
export function normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (args.guid === undefined && typeof args.instanceGuid === "string") {
    const { instanceGuid, ...rest } = args;
    return { ...rest, guid: instanceGuid };
  }
  return args;
}
