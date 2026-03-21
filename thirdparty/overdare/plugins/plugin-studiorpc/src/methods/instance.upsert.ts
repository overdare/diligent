// @summary Defines batched argument schemas for instance upserts.
import { z } from "zod";
import { params as instanceAddParams } from "./instance.params.ts";

const addParams = instanceAddParams;

const updateParams = z
  .object({
    guid: z.string().describe("ActorGuid of the target instance in .ovdrjm"),
    properties: z.record(z.unknown()).describe("Partial properties to merge into the target instance"),
  })
  .strict();

const batchAddParams = z
  .object({
    mode: z.literal("add").describe("Batch add mode"),
    items: z.array(addParams).min(1).describe("Instances to add under their parentGuid targets"),
  })
  .strict();

const batchUpdateParams = z
  .object({
    mode: z.literal("update").describe("Batch update mode"),
    items: z.array(updateParams).min(1).describe("Instances to update by ActorGuid"),
  })
  .strict();

export const method = "instance.upsert";

export const description =
  "Upsert instances in batch. Use mode='add' with items[{ parentGuid, class, name, properties }] or mode='update' with items[{ guid, properties }].";

export const params = z.union([batchAddParams, batchUpdateParams]);

type InstanceUpsertAddArgs = z.infer<typeof addParams>;
type InstanceUpsertUpdateArgs = z.infer<typeof updateParams>;
export type InstanceUpsertBatchAddArgs = z.infer<typeof batchAddParams>;
export type InstanceUpsertBatchUpdateArgs = z.infer<typeof batchUpdateParams>;
export type InstanceUpsertArgs = z.infer<typeof params>;

export type InstanceUpsertMode = "add" | "update";

export type InstanceUpsertOperationBatch =
  | { mode: "add"; items: InstanceUpsertAddArgs[] }
  | { mode: "update"; items: InstanceUpsertUpdateArgs[] };

export function isBatchAddArgs(value: InstanceUpsertArgs): value is InstanceUpsertBatchAddArgs {
  return value.mode === "add";
}

export function isBatchUpdateArgs(value: InstanceUpsertArgs): value is InstanceUpsertBatchUpdateArgs {
  return value.mode === "update";
}

export function isBatchArgs(
  value: InstanceUpsertArgs,
): value is InstanceUpsertBatchAddArgs | InstanceUpsertBatchUpdateArgs {
  return "mode" in value && Array.isArray(value.items);
}

export function normalizeArgsToBatch(value: InstanceUpsertArgs): InstanceUpsertOperationBatch {
  return value;
}

export function parseArgs(value: Record<string, unknown>): InstanceUpsertArgs {
  return params.parse(value);
}
