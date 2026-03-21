// @summary Defines batched argument schemas for instance upserts.
import { z } from "zod";
import { params as instanceAddParams } from "./instance.params.ts";

const addParams = instanceAddParams;
const topLevelParams = z
  .object({
    mode: z.enum(["add", "update"]).describe("Batch operation mode"),
    items: z
      .array(z.record(z.unknown()))
      .min(1)
      .describe(
        "Batch operation items. Shape depends on mode: add uses parentGuid/class/name/properties; update uses guid/properties.",
      ),
  })
  .strict();

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

export const params = topLevelParams;

type InstanceUpsertAddArgs = z.infer<typeof addParams>;
type InstanceUpsertUpdateArgs = z.infer<typeof updateParams>;
export type InstanceUpsertBatchAddArgs = z.infer<typeof batchAddParams>;
export type InstanceUpsertBatchUpdateArgs = z.infer<typeof batchUpdateParams>;
export type InstanceUpsertArgs = InstanceUpsertBatchAddArgs | InstanceUpsertBatchUpdateArgs;

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
  if (value.mode === "add") {
    return value;
  }
  return value;
}

export function parseArgs(value: Record<string, unknown>): InstanceUpsertArgs {
  const parsed = topLevelParams.parse(value);
  if (parsed.mode === "add") {
    return batchAddParams.parse(parsed);
  }
  return batchUpdateParams.parse(parsed);
}
