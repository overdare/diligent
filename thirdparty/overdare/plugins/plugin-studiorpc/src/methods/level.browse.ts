import { z } from "zod";

export const method = "level.browse";

export const description =
  'Browse the level instance tree. Returns instances with guid, name, class, children, and optional filename (e.g. "WorldManagerScript_1.lua" for Script instances). Optionally filter by classType to return only instances of a specific class.';

export const params = z.object({
  startGuid: z.string().optional().describe("If provided, start browsing from this instance instead of the root."),
  classType: z
    .string()
    .optional()
    .describe('If provided, only return instances whose class matches this value (e.g. "Script", "Part").'),
});
