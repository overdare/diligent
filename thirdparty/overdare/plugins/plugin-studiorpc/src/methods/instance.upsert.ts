// @summary Defines batched argument schemas for instance upserts.
import { z } from "zod";
import { instanceClassEnum, instancePropertiesSchema } from "./instance.params.ts";

const addParams = z
  .object({
    class: instanceClassEnum,
    parentGuid: z.string(),
    name: z.string(),
    properties: instancePropertiesSchema,
  })
  .strict();

const updateParams = z
  .object({
    guid: z.string(),
    name: z.string().optional(),
    properties: instancePropertiesSchema,
  })
  .strict();

const itemParams = z
  .union([addParams, updateParams])
  .describe(
    "Each item is inferred by its fields: add uses parentGuid/class/name/properties, update uses guid/(optional name)/properties.",
  );

export const params = z
  .object({
    items: z.array(itemParams).min(1).describe("Batch items inferred as add or update by their fields."),
  })
  .strict();

export const method = "instance.upsert";

export const description =
  "Upsert instances in batch. Each item is inferred by its fields: add uses parentGuid/class/name/properties, update uses guid with optional name and properties. Mixed add and update items are allowed in one call.";

export type InstanceUpsertAddArgs = z.infer<typeof addParams>;
export type InstanceUpsertUpdateArgs = z.infer<typeof updateParams>;
export type InstanceUpsertItemArgs = InstanceUpsertAddArgs | InstanceUpsertUpdateArgs;
export type InstanceUpsertArgs = z.infer<typeof params>;

export type InstanceUpsertMode = "add" | "update";

export type InstanceUpsertOperation =
  | { mode: "add"; item: InstanceUpsertAddArgs }
  | { mode: "update"; item: InstanceUpsertUpdateArgs };

export function isUpdateItem(value: InstanceUpsertItemArgs): value is InstanceUpsertUpdateArgs {
  return "guid" in value && typeof value.guid === "string";
}

export function normalizeArgsToOperations(value: InstanceUpsertArgs): InstanceUpsertOperation[] {
  return value.items.map((item) => (isUpdateItem(item) ? { mode: "update", item } : { mode: "add", item }));
}

export function parseArgs(value: Record<string, unknown>): InstanceUpsertArgs {
  return params.parse(value);
}
