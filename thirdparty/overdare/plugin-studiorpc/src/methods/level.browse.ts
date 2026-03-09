import { z } from "zod";

export const method = "level.browse";

export const description =
  'Browse the level instance tree. Returns instances with guid, name, class, children, and optional filename (e.g. "WorldManagerScript_1.lua" for Script instances).';

export const params = z.object({});
