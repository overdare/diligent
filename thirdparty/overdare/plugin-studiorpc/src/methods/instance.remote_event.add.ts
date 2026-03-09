import { z } from "zod";

export const method = "instance.remote_event.add";

export const description = "Create a RemoteEvent for async one-way communication between server and client.";

export const params = z.object({
  class: z.literal("RemoteEvent"),
  parentGuid: z.string().describe("GUID of the parent instance"),
  name: z.string(),
  properties: z.object({}).default({}).describe("RemoteEvent has no configurable properties"),
});
