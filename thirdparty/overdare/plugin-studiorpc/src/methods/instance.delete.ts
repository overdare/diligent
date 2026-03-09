import { z } from "zod";

export const method = "instance.delete";

export const description = "Delete any instance by GUID.";

export const params = z.object({
  targetGuid: z.string().describe("GUID of the instance to delete"),
});
